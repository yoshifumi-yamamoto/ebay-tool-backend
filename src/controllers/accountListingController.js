const { fetchAccountListings } = require('../services/accountListingService');

exports.getAccountListings = async (req, res) => {
  const { start_date, end_date, ebay_user_id, researcher, exhibitor } = req.query;

  if (!start_date || !end_date) {
    return res.status(400).json({ message: 'start_date and end_date are required' });
  }

  try {
    const listings = await fetchAccountListings({ start_date, end_date, ebay_user_id, researcher, exhibitor });
    res.status(200).json({ listings });
  } catch (error) {
    console.error('Error fetching account listings:', error.message);
    res.status(500).json({ message: 'Failed to fetch account listings' });
  }
};
