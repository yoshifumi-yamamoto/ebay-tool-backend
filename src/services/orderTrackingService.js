const axios = require('axios');
const supabase = require('../supabaseClient');
const { fetchEbayAccountTokens, refreshEbayToken, getRefreshTokenByEbayUserId } = require("./accountService");
const { logError } = require('./loggingService');
const { logSystemError } = require('./systemErrorService');

const EBAY_FULFILLMENT_API_BASE = 'https://api.ebay.com/sell/fulfillment/v1';

const ensureArray = (value) => {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
};

async function uploadTrackingInfoToEbay({
  orderNo,
  trackingNumber,
  carrierCode,
  shippingServiceCode,
  shippedDate,
  lineItems,
  statusOverride,
}) {
  if (!orderNo) {
    throw new Error('orderNo is required');
  }
  if (!trackingNumber) {
    throw new Error('trackingNumber is required');
  }
  if (!carrierCode) {
    throw new Error('carrierCode is required');
  }

  const { data: order, error: orderFetchError } = await supabase
    .from('orders')
    .select('id, order_no, ebay_user_id, user_id, shipping_status, order_line_items(id, quantity)')
    .eq('order_no', orderNo)
    .single();

  if (orderFetchError || !order) {
    throw new Error('Order not found for tracking upload');
  }

  const refreshToken = await getRefreshTokenByEbayUserId(order.ebay_user_id);
  const accessToken = await refreshEbayToken(refreshToken);

  const resolvedLineItems = Array.isArray(lineItems) && lineItems.length > 0
    ? lineItems
    : (order.order_line_items || []).map((item) => ({
      lineItemId: item.id,
      quantity: item.quantity || 1,
    }));

  const shipmentPayload = {
    trackingNumber,
    shippingCarrierCode: carrierCode,
    lineItems: resolvedLineItems
      .filter((item) => item?.lineItemId)
      .map((item) => ({
        lineItemId: item.lineItemId,
        quantity: item.quantity || 1,
      })),
  };

  if (shipmentPayload.lineItems.length === 0) {
    throw new Error('No line items available for shipment payload');
  }

  if (shippingServiceCode) {
    shipmentPayload.shippingServiceCode = shippingServiceCode;
  }
  if (shippedDate) {
    shipmentPayload.shippedDate = shippedDate;
  }

  let existingFulfillmentId = null;
  try {
    const { data: fulfillmentData } = await axios.get(
      `${EBAY_FULFILLMENT_API_BASE}/order/${orderNo}/shipping_fulfillment`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    existingFulfillmentId = fulfillmentData?.fulfillments?.[0]?.fulfillmentId || null;
  } catch (fetchFulfillmentError) {
    const status = fetchFulfillmentError?.response?.status;
    if (status && status !== 404) {
      console.error(
        '[orderTrackingService] Failed to fetch existing fulfillments before upload',
        JSON.stringify(
          {
            orderNo,
            status,
            data: fetchFulfillmentError?.response?.data,
          },
          null,
          2
        )
      );
      throw new Error('Failed to fetch existing fulfillments from eBay');
    }
  }

  if (existingFulfillmentId) {
    try {
      await axios.delete(
        `${EBAY_FULFILLMENT_API_BASE}/order/${orderNo}/shipping_fulfillment/${existingFulfillmentId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );
      console.info(
        '[orderTrackingService] Existing shipping fulfillment deleted before re-upload',
        JSON.stringify({ orderNo, fulfillmentId: existingFulfillmentId })
      );
    } catch (deleteError) {
      console.error(
        '[orderTrackingService] Failed to delete existing shipping fulfillment before re-upload',
        JSON.stringify(
          {
            orderNo,
            fulfillmentId: existingFulfillmentId,
            status: deleteError?.response?.status,
            data: deleteError?.response?.data,
          },
          null,
          2
        )
      );
      throw new Error('Failed to delete existing fulfillment before updating tracking');
    }
  }

  const requestConfig = {
    url: `${EBAY_FULFILLMENT_API_BASE}/order/${orderNo}/shipping_fulfillment`,
    method: 'post',
    data: shipmentPayload,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  };

  try {
    await axios(requestConfig);
  } catch (error) {
    const ebayErrorPayload = error?.response?.data ?? null;
    console.error(
      '[orderTrackingService] eBay tracking upload failed',
      JSON.stringify(
        {
          orderNo,
          status: error?.response?.status,
          data: ebayErrorPayload,
        },
        null,
        2
      )
    );
    await logError({
      itemId: orderNo,
      errorType: 'EBAY_TRACKING_UPLOAD_ERROR',
      errorMessage: ebayErrorPayload || error.message,
      attemptNumber: 1,
      additionalInfo: {
        functionName: 'uploadTrackingInfoToEbay',
        orderNo,
        status: error?.response?.status,
      },
    });
    await logSystemError({
      error_code: 'EBAY_TRACKING_UPLOAD_FAILED',
      category: 'EXTERNAL',
      severity: 'ERROR',
      provider: 'ebay',
      message: error.message || 'Failed to upload tracking',
      retryable: true,
      payload_summary: { orderNo },
      details: {
        status: error?.response?.status,
        response: ebayErrorPayload,
      },
    });
    throw new Error('Failed to upload tracking information to eBay');
  }

  const nextShippingStatus = statusOverride || 'SHIPPED';
  const { data: updatedOrder, error: updateError } = await supabase
    .from('orders')
    .update({
      shipping_tracking_number: trackingNumber,
      shipping_status: nextShippingStatus,
    })
    .eq('order_no', orderNo)
    .select('*, order_line_items(*)')
    .single();

  if (updateError) {
    console.error(
      '[orderTrackingService] Tracking upload succeeded but failed to update local order',
      JSON.stringify({
        orderNo,
        error: updateError,
      })
    );
    throw new Error('Tracking uploaded but failed to update local order');
  }

  return updatedOrder;
}

module.exports = {
  uploadTrackingInfoToEbay,
  ensureArray,
};
