const { fetchPackingVerification } = require('../services/packingVerificationService');

exports.getPackingVerification = async (req, res) => {
  const { user_id, start_date, end_date, limit, offset, ebay_user_id, shipping_carrier } = req.query;

  try {
    const result = await fetchPackingVerification({
      user_id,
      start_date,
      end_date,
      limit,
      offset,
      ebay_user_id,
      shipping_carrier,
    });
    res.json(result);
  } catch (error) {
    console.error('Failed to fetch packing verification data:', error.message);
    res.status(500).json({ message: 'Failed to fetch packing verification data' });
  }
};
