const { fetchPackingVerification, fetchCarrierRates } = require('../services/packingVerificationService');
const { syncCarrierRatesForUser, syncJapanPostRatesForUser } = require('../services/shipcoRateSyncService');

exports.getPackingVerification = async (req, res) => {
  const {
    user_id,
    start_date,
    end_date,
    limit,
    offset,
    ebay_user_id,
    shipping_carrier,
    order_no,
    tracking_number,
  } = req.query;

  try {
    const result = await fetchPackingVerification({
      user_id,
      start_date,
      end_date,
      limit,
      offset,
      ebay_user_id,
      shipping_carrier,
      order_no,
      tracking_number,
    });
    res.json(result);
  } catch (error) {
    console.error('Failed to fetch packing verification data:', error.message);
    res.status(500).json({ message: 'Failed to fetch packing verification data' });
  }
};

exports.getCarrierRates = async (req, res) => {
  const { limit, offset, carrier, service, destination_scope, zone, is_active, include_all } = req.query;

  try {
    const result = await fetchCarrierRates({
      limit,
      offset,
      carrier,
      service,
      destination_scope,
      zone,
      is_active,
      include_meta: true,
      include_all: String(include_all) === 'true',
    });
    res.json(result);
  } catch (error) {
    console.error('Failed to fetch carrier rates:', error.message);
    res.status(500).json({ message: 'Failed to fetch carrier rates' });
  }
};

exports.downloadCarrierRatesCsv = async (req, res) => {
  const { carrier, service, destination_scope, zone, is_active } = req.query;
  try {
    const result = await fetchCarrierRates({
      carrier,
      service,
      destination_scope,
      zone,
      is_active,
      include_meta: false,
      include_all: true,
    });
    const rows = Array.isArray(result.data) ? result.data : [];
    const header = [
      'carrier',
      'service_code',
      'service_name',
      'destination_scope',
      'zone',
      'weight_max_g',
      'price_yen',
      'source',
      'last_synced_at',
      'is_active',
    ];
    const escapeCsv = (value) => {
      if (value === null || value === undefined) return '';
      const str = String(value);
      if (str.includes(',') || str.includes('\"') || str.includes('\n')) {
        return `\"${str.replace(/\"/g, '\"\"')}\"`;
      }
      return str;
    };
    const csvLines = [
      header.join(','),
      ...rows.map((row) =>
        header.map((key) => escapeCsv(row[key])).join(',')
      ),
    ];
    const filenameParts = ['shipping_rates'];
    if (carrier) filenameParts.push(carrier);
    if (destination_scope) filenameParts.push(destination_scope);
    const filename = `${filenameParts.join('_')}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=\"${filename}\"`);
    res.send(csvLines.join('\n'));
  } catch (error) {
    console.error('Failed to download carrier rates CSV:', error.message);
    res.status(500).json({ message: 'Failed to download carrier rates CSV' });
  }
};

exports.syncCarrierRates = async (req, res) => {
  const { user_id, weights_g } = req.body || {};
  const numericUserId = Number(user_id);
  if (!Number.isFinite(numericUserId)) {
    res.status(400).json({ message: 'user_id is required' });
    return;
  }
  try {
    const weightOverrides = Array.isArray(weights_g) ? weights_g : [];
    const result = await syncCarrierRatesForUser(numericUserId, weightOverrides);
    const jpResult = await syncJapanPostRatesForUser(numericUserId, []);
    res.status(200).json({ message: 'Carrier rate sync completed', ...result, jp_post: jpResult });
  } catch (error) {
    console.error('Failed to enqueue carrier rate sync:', error.message);
    res.status(500).json({ message: 'Failed to sync carrier rates' });
  }
};
