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
  const lineItems = Array.isArray(order.order_line_items) ? order.order_line_items : [];
  const lineTitles = lineItems.map((item) => item?.title).filter(Boolean);
  const totalQuantity =
    lineItems.reduce((sum, item) => sum + (Number(item?.quantity) || 0), 0) || 1;
  let productName = 'Merchandise';
  if (lineTitles.length === 1) {
    productName = lineTitles[0];
  } else if (lineTitles.length > 1) {
    productName = `${lineTitles[0]} +${lineTitles.length - 1}`;
  }
  return {
    customs: {
      content_type: 'MERCHANDISE',
      duty_paid: Boolean(setup?.ddp),
      ioss_number: setup?.ioss_number || null,
    },
    products: [
      {
        name: productName,
        quantity: totalQuantity,
        price: amount,
        origin_country: 'JP',
        currency,
        hs_code: null,
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

module.exports = {
  buildShipcoAddress,
  buildDefaultParcel,
  buildDefaultCustoms,
  normalizeParcels,
  buildRatePayload,
  buildSenderAddress,
};
