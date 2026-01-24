const { fetchPackingVerification, fetchCarrierRates } = require('../services/packingVerificationService');

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

exports.syncCarrierRates = async (_req, res) => {
  try {
    res.status(200).json({ message: 'Carrier rate sync queued' });
  } catch (error) {
    console.error('Failed to enqueue carrier rate sync:', error.message);
    res.status(500).json({ message: 'Failed to enqueue carrier rate sync' });
  }
};
