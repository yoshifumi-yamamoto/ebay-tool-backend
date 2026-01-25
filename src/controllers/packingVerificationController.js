const { fetchPackingVerification, fetchCarrierRates } = require('../services/packingVerificationService');
const { syncCarrierRatesForUser } = require('../services/shipcoRateSyncService');

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
  const { limit, offset, carrier, service, destination_scope, zone, is_active } = req.query;

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
    });
    res.json(result);
  } catch (error) {
    console.error('Failed to fetch carrier rates:', error.message);
    res.status(500).json({ message: 'Failed to fetch carrier rates' });
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
    const result = await syncCarrierRatesForUser(numericUserId, Array.isArray(weights_g) ? weights_g : []);
    res.status(200).json({ message: 'Carrier rate sync completed', ...result });
  } catch (error) {
    console.error('Failed to enqueue carrier rate sync:', error.message);
    res.status(500).json({ message: 'Failed to sync carrier rates' });
  }
};
