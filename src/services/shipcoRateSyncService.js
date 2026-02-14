const supabase = require('../supabaseClient');
const fs = require('fs');
const path = require('path');
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
const JP_POST_CARRIERS = new Set(['japanpost']);

const SHIPCO_TO_DB_CARRIER = {
  fedex: 'FEDEX',
  dhl: 'DHL',
  japanpost: 'JP_POST',
};

const LOG_DIR = path.join(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'shipco_rate_sync.log');

const appendLog = (line) => {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
  } catch (err) {
    console.error('Failed to write shipco sync log:', err);
  }
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

const normalizeJapanPostRates = (rates = []) =>
  rates
    .map((rate) => {
      const carrier = rate?.carrier;
      if (!carrier || !JP_POST_CARRIERS.has(carrier)) return null;
      const currency = rate?.currency;
      if (currency && currency !== 'JPY') return null;
      const price = Number(rate?.price);
      if (!Number.isFinite(price)) return null;
      return {
        carrier,
        service: rate?.service,
        price,
        zone: rate?.zone ?? null,
      };
    })
    .filter(Boolean);

const buildJapanPostEpacketWeights = () => {
  const weights = [];
  for (let g = 100; g <= 2000; g += 100) {
    weights.push(g);
  }
  return weights;
};

const buildJapanPostEmsWeights = () => {
  const weights = [];
  for (let g = 500; g <= 1000; g += 100) {
    weights.push(g);
  }
  for (let g = 1250; g <= 2000; g += 250) {
    weights.push(g);
  }
  for (let g = 2500; g <= 6000; g += 500) {
    weights.push(g);
  }
  for (let g = 7000; g <= 30000; g += 1000) {
    weights.push(g);
  }
  return weights;
};

const buildJapanPostWeights = () => {
  const weights = new Set([
    ...buildJapanPostEpacketWeights(),
    ...buildJapanPostEmsWeights(),
  ]);
  return Array.from(weights).sort((a, b) => a - b);
};

async function syncCarrierRatesForUser(userId, weightsG = []) {
  const sender = await getSenderByUserId(userId);
  if (!sender) {
    throw new Error('Ship&co sender is not configured.');
  }

  const now = new Date().toISOString();
  const weightList =
    weightsG.length > 0
      ? weightsG
      : Array.from({ length: 140 }, (_value, index) => (index + 1) * 500);
  appendLog(`[${now}] start user=${userId} weights=${weightList.length}`);
  appendLog(`[${now}] weights=${JSON.stringify(weightList)}`);
  const destinations = [
    { scope: 'US', address: DEFAULT_TO_ADDRESS_US },
    { scope: 'GB', address: DEFAULT_TO_ADDRESS_GB },
    { scope: 'SG', address: DEFAULT_TO_ADDRESS_SG },
  ];
  const recordMap = new Map();

  for (const destination of destinations) {
    for (const weightG of weightList) {
      appendLog(`[${new Date().toISOString()}] fetch rates scope=${destination.scope} weight_g=${weightG}`);
      const payload = buildPayloadForWeight(sender, destination.address, weightG);
      const response = await shipcoService.fetchRates(payload);
      const ratesArray = Array.isArray(response)
        ? response
        : Array.isArray(response?.rates)
          ? response.rates
          : [];
      const normalized = normalizeRates(ratesArray);
      appendLog(`[${new Date().toISOString()}] rates scope=${destination.scope} weight_g=${weightG} raw=${ratesArray.length} normalized=${normalized.length}`);
      normalized.forEach((rate) => {
        const dbCarrier = SHIPCO_TO_DB_CARRIER[rate.carrier];
        if (!dbCarrier || !rate.service) return;
        const key = `${dbCarrier}::${rate.service}::${destination.scope}::${weightG}`;
        if (recordMap.has(key)) {
          appendLog(`[${new Date().toISOString()}] duplicate key=${key}`);
        }
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
  appendLog(`[${new Date().toISOString()}] unique_records=${records.length}`);

  if (records.length === 0) {
    appendLog(`[${new Date().toISOString()}] end no_records`);
    return { inserted: 0 };
  }

  const { data, error } = await supabase
    .from('shipping_rates')
    .upsert(records, {
      onConflict: 'carrier,service_code,destination_scope,zone,weight_max_g',
    })
    .select('id');
  if (error) {
    appendLog(`[${new Date().toISOString()}] upsert_error=${error.message}`);
    throw new Error('Failed to upsert shipping rates: ' + error.message);
  }
  appendLog(`[${new Date().toISOString()}] end inserted=${data?.length || 0}`);
  return { inserted: data?.length || 0 };
}

async function syncJapanPostRatesForUser(userId, weightsG = []) {
  const sender = await getSenderByUserId(userId);
  if (!sender) {
    throw new Error('Ship&co sender is not configured.');
  }

  const now = new Date().toISOString();
  const epacketWeights = buildJapanPostEpacketWeights();
  const emsWeights = buildJapanPostEmsWeights();
  const weightList = weightsG.length > 0 ? weightsG : buildJapanPostWeights();
  appendLog(`[${now}] start_jp_post user=${userId} weights=${weightList.length}`);
  appendLog(`[${now}] jp_post_weights=${JSON.stringify(weightList)}`);

  const destination = { scope: 'ZONE', address: DEFAULT_TO_ADDRESS_US };
  const recordMap = new Map();

  for (const weightG of weightList) {
    appendLog(`[${new Date().toISOString()}] fetch jp_post scope=${destination.scope} weight_g=${weightG}`);
    const payload = buildPayloadForWeight(sender, destination.address, weightG);
    const response = await shipcoService.fetchRates(payload);
    const ratesArray = Array.isArray(response)
      ? response
      : Array.isArray(response?.rates)
        ? response.rates
        : [];
    const normalized = normalizeJapanPostRates(ratesArray);
    appendLog(`[${new Date().toISOString()}] jp_post rates weight_g=${weightG} raw=${ratesArray.length} normalized=${normalized.length}`);
    normalized.forEach((rate) => {
      const dbCarrier = SHIPCO_TO_DB_CARRIER[rate.carrier];
      if (!dbCarrier || !rate.service) return;
      if (rate.service === 'japanpost_epacket_light' && !epacketWeights.includes(weightG)) {
        return;
      }
      if (rate.service === 'japanpost_ems' && !emsWeights.includes(weightG)) {
        return;
      }
      const key = `${dbCarrier}::${rate.service}::${destination.scope}::${rate.zone || ''}::${weightG}`;
      if (recordMap.has(key)) {
        appendLog(`[${new Date().toISOString()}] jp_post duplicate key=${key}`);
      }
      recordMap.set(key, {
        carrier: dbCarrier,
        service_code: rate.service,
        destination_scope: destination.scope,
        zone: rate.zone || null,
        weight_max_g: weightG,
        price_yen: Math.round(rate.price),
        source: 'shipco',
        last_synced_at: now,
        is_active: true,
      });
    });
  }

  const records = Array.from(recordMap.values());
  appendLog(`[${new Date().toISOString()}] jp_post unique_records=${records.length}`);
  if (records.length === 0) {
    appendLog(`[${new Date().toISOString()}] jp_post end no_records`);
    return { inserted: 0 };
  }

  const { data, error } = await supabase
    .from('shipping_rates')
    .upsert(records, {
      onConflict: 'carrier,service_code,destination_scope,zone,weight_max_g',
    })
    .select('id');
  if (error) {
    appendLog(`[${new Date().toISOString()}] jp_post upsert_error=${error.message}`);
    throw new Error('Failed to upsert japan post rates: ' + error.message);
  }
  appendLog(`[${new Date().toISOString()}] jp_post end inserted=${data?.length || 0}`);
  return { inserted: data?.length || 0 };
}

module.exports = {
  syncCarrierRatesForUser,
  syncJapanPostRatesForUser,
};
