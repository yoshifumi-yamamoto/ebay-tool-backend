const supabase = require('../supabaseClient');
const shipcoService = require('./shipcoService');
const shipcoSenderService = require('./shipcoSenderService');
const orderService = require('./orderService');
const {
  buildShipcoAddress,
  buildDefaultParcel,
  buildDefaultCustoms,
  normalizeParcels,
  buildRatePayload,
  buildSenderAddress,
} = require('./shipcoPayloadBuilder');

const fetchOrder = async (orderNo, userId) => {
  const { data, error } = await supabase
    .from('orders')
    .select('order_no, ship_to, subtotal, subtotal_currency, total_amount_currency, earnings, earnings_currency, shipco_parcel_weight, shipco_parcel_length, shipco_parcel_width, shipco_parcel_height, estimated_parcel_weight, estimated_parcel_length, estimated_parcel_width, estimated_parcel_height')
    .eq('order_no', orderNo)
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) {
    throw new Error('Order not found');
  }
  return data;
};

async function estimateRates(orderNo, userId, payload = {}) {
  const { to_address, parcels, products, customs, setup, options } = payload;
  const sender = await shipcoSenderService.getSenderByUserId(userId);
  if (!sender) {
    throw new Error('Sender is not configured');
  }
  const order = await fetchOrder(orderNo, userId);
  const toAddress = to_address || buildShipcoAddress(order?.ship_to || {});
  const resolvedParcels = Array.isArray(parcels) && parcels.length > 0
    ? parcels
    : (() => {
      const defaultParcel = buildDefaultParcel(order || {});
      return defaultParcel ? [defaultParcel] : [];
    })();
  if (resolvedParcels.length === 0) {
    throw new Error('parcel info is required');
  }
  const requestPayload = buildRatePayload({
    toAddress,
    fromAddress: buildSenderAddress(sender),
    parcels: normalizeParcels(resolvedParcels),
    products: products || [],
    customs: customs || undefined,
    setup: { ...(setup || {}), ...(options || {}) },
  });
  const isInternational =
    sender.country &&
    toAddress?.country &&
    String(sender.country).toUpperCase() !== String(toAddress.country).toUpperCase();
  if (isInternational && (!products || products.length === 0 || !customs)) {
    const defaults = buildDefaultCustoms(order || {}, requestPayload.setup || {});
    requestPayload.products = defaults.products;
    requestPayload.customs = defaults.customs;
    if (!requestPayload.setup?.currency) {
      requestPayload.setup = { ...(requestPayload.setup || {}), currency: defaults.products[0].currency };
    }
  }
  return await shipcoService.fetchRates(requestPayload);
}

async function createShipment(orderNo, userId, payload = {}) {
  const { to_address, parcels, products, customs, setup, options } = payload;
  if (!setup || !setup.carrier || !setup.service) {
    throw new Error('setup.carrier and setup.service are required');
  }
  const sender = await shipcoSenderService.getSenderByUserId(userId);
  if (!sender) {
    throw new Error('Sender is not configured');
  }
  const order = await fetchOrder(orderNo, userId);
  const toAddress = to_address || buildShipcoAddress(order?.ship_to || {});
  const resolvedParcels = Array.isArray(parcels) && parcels.length > 0
    ? parcels
    : (() => {
      const defaultParcel = buildDefaultParcel(order || {});
      return defaultParcel ? [defaultParcel] : [];
    })();
  if (resolvedParcels.length === 0) {
    throw new Error('parcel info is required');
  }

  const requestPayload = buildRatePayload({
    toAddress,
    fromAddress: buildSenderAddress(sender),
    parcels: normalizeParcels(resolvedParcels),
    products: products || [],
    customs: customs || undefined,
    setup: { ...(setup || {}), ...(options || {}) },
  });
  const isInternational =
    sender.country &&
    toAddress?.country &&
    String(sender.country).toUpperCase() !== String(toAddress.country).toUpperCase();
  if (isInternational && (!products || products.length === 0 || !customs)) {
    const defaults = buildDefaultCustoms(order || {}, requestPayload.setup || {});
    requestPayload.products = defaults.products;
    requestPayload.customs = defaults.customs;
    if (!requestPayload.setup?.currency) {
      requestPayload.setup = { ...(requestPayload.setup || {}), currency: defaults.products[0].currency };
    }
  }

  const shipment = await shipcoService.createShipment(requestPayload);
  const trackingNumber = shipcoService.extractTrackingFromShipment(shipment);
  const carrierCode = shipcoService.extractCarrierFromShipment(shipment);
  const labelUrl = shipment?.delivery?.label || null;
  if (!trackingNumber || !carrierCode) {
    throw new Error('tracking number or carrier code missing from Ship&Co response');
  }

  await orderService.uploadTrackingInfoToEbay({
    orderNo,
    trackingNumber,
    carrierCode,
    statusOverride: 'READY',
  });

  return { shipment, trackingNumber, carrierCode, labelUrl };
}

module.exports = {
  estimateRates,
  createShipment,
};
