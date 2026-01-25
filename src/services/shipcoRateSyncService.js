const supabase = require('../supabaseClient');
const { buildRatePayload } = require('./shipcoPayloadBuilder');
const shipcoService = require('./shipcoService');
const { getSenderByUserId } = require('./shipcoSenderService');

const DEFAULT_TO_ADDRESS_US = {
  full_name: 'John Doe',
  company: 'Sample Co',
  country: 'US',
  zip: '94043',
  province: 'CA',
  city: 'Mountain View',
  address1: '1600 Amphitheatre Parkway',
  phone: '6500000000',
  email: 'sample@example.com',
};

const DEFAULT_TO_ADDRESS_GB = {
  full_name: 'John Smith',
  company: 'Sample Co',
  country: 'GB',
  zip: 'SW1A 1AA',
  province: 'LND',
  city: 'London',
  address1: '10 Downing Street',
  phone: '0200000000',
  email: 'sample@example.com',
};

const DEFAULT_TO_ADDRESS_SG = {
  full_name: 'Wei Ming',
  company: 'Sample Co',
  country: 'SG',
  zip: '048581',
  province: 'SG',
  city: 'Singapore',
  address1: '1 Raffles Place',
  phone: '60000000',
  email: 'sample@example.com',
};

const DEFAULT_PARCEL = {
  width: 10,
  height: 10,
  depth: 10,
  amount: 1,
};

const DEFAULT_PRODUCT = {
  name: 'Sample Item',
  quantity: 1,
  price: 1000,
  origin_country: 'JP',
};

const DEFAULT_CUSTOMS = {
  content_type: 'MERCHANDISE',
};

const DEFAULT_SETUP = {
  currency: 'JPY',
  signature: false,
};

const FEDEX_DHL_CARRIERS = new Set(['fedex', 'dhl']);

const SHIPCO_TO_DB_CARRIER = {
  fedex: 'FEDEX',
  dhl: 'DHL',
};

const buildPayloadForWeight = (fromAddress, toAddress, weightG) =>
  buildRatePayload({
    fromAddress,
    toAddress,
    parcels: [{ ...DEFAULT_PARCEL, weight: weightG }],
    products: [DEFAULT_PRODUCT],
    customs: DEFAULT_CUSTOMS,
    setup: DEFAULT_SETUP,
  });

const normalizeRates = (rates = []) =>
  rates
    .map((rate) => {
      const carrier = rate?.carrier;
      if (!carrier || !FEDEX_DHL_CARRIERS.has(carrier)) return null;
      const currency = rate?.currency;
      if (currency && currency !== 'JPY') return null;
      const price = Number(rate?.price);
      if (!Number.isFinite(price)) return null;
      return {
        carrier,
        service: rate?.service,
        price,
      };
    })
    .filter(Boolean);

async function syncCarrierRatesForUser(userId, weightsG = []) {
  const sender = await getSenderByUserId(userId);
  if (!sender) {
    throw new Error('Ship&co sender is not configured.');
  }

  const now = new Date().toISOString();
  const weightList =
    weightsG.length > 0
      ? weightsG
      : Array.from({ length: 60 }, (_value, index) => (index + 1) * 500);
  const destinations = [
    { scope: 'US', address: DEFAULT_TO_ADDRESS_US },
    { scope: 'GB', address: DEFAULT_TO_ADDRESS_GB },
    { scope: 'SG', address: DEFAULT_TO_ADDRESS_SG },
  ];
  const recordMap = new Map();

  for (const destination of destinations) {
    for (const weightG of weightList) {
      const payload = buildPayloadForWeight(sender, destination.address, weightG);
      const response = await shipcoService.fetchRates(payload);
      const ratesArray = Array.isArray(response)
        ? response
        : Array.isArray(response?.rates)
          ? response.rates
          : [];
      const normalized = normalizeRates(ratesArray);
      normalized.forEach((rate) => {
        const dbCarrier = SHIPCO_TO_DB_CARRIER[rate.carrier];
        if (!dbCarrier || !rate.service) return;
        const key = `${dbCarrier}::${rate.service}::${destination.scope}::${weightG}`;
        recordMap.set(key, {
          carrier: dbCarrier,
          service_code: rate.service,
          destination_scope: destination.scope,
          zone: null,
          weight_max_g: weightG,
          price_yen: Math.round(rate.price),
          source: 'shipco',
          last_synced_at: now,
          is_active: true,
        });
      });
    }
  }

  const records = Array.from(recordMap.values());

  if (records.length === 0) {
    return { inserted: 0 };
  }

  const { data, error } = await supabase
    .from('shipping_rates')
    .upsert(records, {
      onConflict: 'carrier,service_code,destination_scope,zone,weight_max_g',
    })
    .select('id');
  if (error) {
    throw new Error('Failed to upsert shipping rates: ' + error.message);
  }
  return { inserted: data?.length || 0 };
}

module.exports = {
  syncCarrierRatesForUser,
};
