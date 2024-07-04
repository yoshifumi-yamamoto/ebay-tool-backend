const { fetchOrdersWithFilters, fetchOrderSummary } = require('../services/orderSummaryService');

exports.getOrders = async (req, res) => {
  const { start_date, end_date, user_id, ebay_user_id, status, buyer_country_code, researcher, page, limit } = req.query;

  try {
      const { orders, totalOrders } = await fetchOrdersWithFilters({ start_date, end_date, user_id, ebay_user_id, status, buyer_country_code, researcher, page, limit });
      res.status(200).json({ orders, totalOrders });
  } catch (error) {
      console.error('Error fetching orders:', error.message);
      res.status(500).json({ message: 'Failed to fetch orders' });
  }
};

exports.getOrderSummary = async (req, res) => {
  const { user_id, start_date, end_date, ebay_user_id, status, buyer_country_code, researcher } = req.query;

  if (!user_id || !start_date || !end_date) {
    return res.status(400).json({ message: 'user_id, start_date and end_date are required' });
  }

  try {
    const summary = await fetchOrderSummary({ user_id, start_date, end_date, ebay_user_id, status, buyer_country_code, researcher });
    res.status(200).json(summary);
  } catch (error) {
    console.error('Error fetching order summary:', error.message);
    res.status(500).json({ message: 'Failed to fetch order summary' });
  }
};
