const supabase = require('../supabaseClient');
const shipcoService = require('./shipcoService');
const shipcoSenderService = require('./shipcoSenderService');
const orderService = require('./orderService');

const buildShipcoAddress = (shipTo = {}) => {
  const contact = shipTo.contactAddress || shipTo.contact_address || {};
  return {
    full_name: shipTo.fullName || shipTo.full_name || shipTo.name || null,
    phone: shipTo.phoneNumber || shipTo.phone || contact.phone || null,
    email: shipTo.email || contact.email || null,
    company: contact.companyName || contact.company || null,
    country: contact.countryCode || shipTo.countryCode || shipTo.country || null,
    zip: contact.postalCode || shipTo.postalCode || shipTo.zip || null,
    province: contact.stateOrProvince || shipTo.state || shipTo.province || null,
    city: contact.city || shipTo.city || null,
    address1: contact.addressLine1 || shipTo.address1 || null,
    address2: contact.addressLine2 || shipTo.address2 || null,
    address3: contact.addressLine3 || shipTo.address3 || null,
  };
};

const buildDefaultParcel = (order = {}) => {
  const weight = order.shipco_parcel_weight || order.estimated_parcel_weight || null;
  const length = order.shipco_parcel_length || order.estimated_parcel_length || null;
  const width = order.shipco_parcel_width || order.estimated_parcel_width || null;
  const height = order.shipco_parcel_height || order.estimated_parcel_height || null;
  if (!weight && !length && !width && !height) {
    return null;
  }
  return {
    weight: Number(weight) || 0,
    width: Number(width) || 0,
    height: Number(height) || 0,
    depth: Number(length) || 0,
    amount: 1,
  };
};

const buildDefaultCustoms = (order = {}, setup = {}) => {
  const currency =
    setup?.currency ||
    order.subtotal_currency ||
    order.total_amount_currency ||
    order.earnings_currency ||
    'JPY';
  const amount =
    typeof order.subtotal === 'number'
      ? order.subtotal
      : typeof order.earnings === 'number'
        ? order.earnings
        : 1;
  return {
    customs: { content_type: 'MERCHANDISE' },
    products: [
      {
        name: 'Merchandise',
        quantity: 1,
        price: amount,
        origin_country: 'JP',
        currency,
      },
    ],
  };
};

const normalizeParcels = (parcels = []) =>
  parcels.map((parcel) => ({
    ...parcel,
    amount: Number(parcel?.amount) > 0 ? Number(parcel.amount) : 1,
  }));

const buildRatePayload = ({ toAddress, fromAddress, parcels, products, customs, setup }) => ({
  to_address: toAddress,
  from_address: fromAddress,
  parcels,
  products,
  customs,
  setup,
});

const buildSenderAddress = (sender = {}) => ({
  full_name: sender.full_name || null,
  phone: sender.phone || null,
  email: sender.email || null,
  company: sender.company || null,
  country: sender.country || null,
  zip: sender.zip || null,
  province: sender.province || null,
  city: sender.city || null,
  address1: sender.address1 || null,
  address2: sender.address2 || null,
  address3: sender.address3 || null,
});

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
