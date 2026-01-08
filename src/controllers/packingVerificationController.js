const { fetchPackingVerification } = require('../services/packingVerificationService');

exports.getPackingVerification = async (req, res) => {
  const { user_id, start_date, end_date, limit } = req.query;

  try {
    const data = await fetchPackingVerification({
      user_id,
      start_date,
      end_date,
      limit,
    });
    res.json({ data });
  } catch (error) {
    console.error('Failed to fetch packing verification data:', error.message);
    res.status(500).json({ message: 'Failed to fetch packing verification data' });
  }
};
