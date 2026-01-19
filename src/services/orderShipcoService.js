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
  requestPayload.reference = orderNo;
  if (requestPayload.customs && requestPayload.setup?.ddp !== undefined) {
    requestPayload.customs.duty_paid = Boolean(requestPayload.setup.ddp);
  }
  if (requestPayload.customs && requestPayload.setup?.ioss_number) {
    requestPayload.customs.ioss_number = requestPayload.setup.ioss_number;
  }
  if (requestPayload.customs && requestPayload.setup?.ddp !== undefined) {
    requestPayload.customs.duty_paid = Boolean(requestPayload.setup.ddp);
  }
  if (requestPayload.customs && requestPayload.setup?.ioss_number) {
    requestPayload.customs.ioss_number = requestPayload.setup.ioss_number;
  }
  console.info('[orderShipcoService] create shipment payload', requestPayload);
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
  const rawRates = await shipcoService.fetchRates(requestPayload);
  const ratesArray = Array.isArray(rawRates)
    ? rawRates
    : Array.isArray(rawRates?.rates)
      ? rawRates.rates
      : [];
  const rateErrors = ratesArray
    .filter((rate) => Array.isArray(rate?.errors) && rate.errors.length > 0)
    .flatMap((rate) => rate.errors);
  const normalizedRates = ratesArray
    .filter((rate) => !(Array.isArray(rate?.errors) && rate.errors.length > 0))
    .map((rate) => {
    const rateObj = rate && typeof rate === 'object' ? rate : {};
    const rateAmountCandidate =
      rateObj.amount ??
      rateObj.rate ??
      rateObj.price ??
      rateObj.cost ??
      rateObj.total ??
      rateObj.total_amount ??
      rateObj.totalAmount ??
      rateObj.charge ??
      null;
    const rateAmountValue =
      rateAmountCandidate && typeof rateAmountCandidate === 'object'
        ? rateAmountCandidate.amount ?? rateAmountCandidate.value ?? null
        : rateAmountCandidate;
    const normalizedAmount =
      rateAmountValue === null || rateAmountValue === undefined
        ? null
        : Number.isFinite(Number(rateAmountValue))
          ? Number(rateAmountValue)
          : rateAmountValue;
    const normalizedCurrency =
      rateObj.currency ||
      (rateAmountCandidate && typeof rateAmountCandidate === 'object' ? rateAmountCandidate.currency : null) ||
      null;
    const normalizedCarrier =
      rateObj.carrier || rateObj.carrier_code || rateObj.carrierCode || null;
    const normalizedService =
      rateObj.service || rateObj.service_code || rateObj.serviceCode || null;
    return {
      ...rateObj,
      carrier: normalizedCarrier,
      service: normalizedService,
      amount: normalizedAmount,
      currency: normalizedCurrency,
    };
  });
  return { rates: normalizedRates, errors: rateErrors };
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
  requestPayload.reference = orderNo;
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
  const shipmentId = shipment?.id || null;
  if (!trackingNumber || !carrierCode) {
    throw new Error('tracking number or carrier code missing from Ship&Co response');
  }

  await orderService.uploadTrackingInfoToEbay({
    orderNo,
    trackingNumber,
    carrierCode,
    statusOverride: 'READY',
  });

  const { data: existingGroupLink } = await supabase
    .from('shipment_group_orders')
    .select('group_id')
    .eq('order_no', orderNo)
    .maybeSingle();
  if (existingGroupLink?.group_id) {
    await supabase
      .from('shipment_groups')
      .update({
        status: 'ready',
        primary_order_no: orderNo,
        tracking_number: trackingNumber,
        label_url: labelUrl,
        shipment_id: shipmentId,
        shipping_carrier: carrierCode,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingGroupLink.group_id);
  } else {
    const { data: insertedGroup, error: insertError } = await supabase
      .from('shipment_groups')
      .insert({
        user_id: userId,
        status: 'ready',
        primary_order_no: orderNo,
        tracking_number: trackingNumber,
        label_url: labelUrl,
        shipment_id: shipmentId,
        shipping_carrier: carrierCode,
      })
      .select('id')
      .single();
    if (!insertError && insertedGroup?.id) {
      await supabase
        .from('shipment_group_orders')
        .insert({
          group_id: insertedGroup.id,
          order_no: orderNo,
        });
    }
  }

  return { shipment, trackingNumber, carrierCode, labelUrl };
}

module.exports = {
  estimateRates,
  createShipment,
};
