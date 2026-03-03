const { fetchUsDutyOrders } = require('../services/usDutyService');

exports.getUsDutyOrders = async (req, res) => {
  const userId = Number(req.query.user_id || req.query.userId);
  if (!userId) {
    return res.status(400).json({ error: 'user_id is required' });
  }
  try {
    const { orders, total } = await fetchUsDutyOrders(userId, {
      limit: req.query.limit,
      page: req.query.page,
      order_no: req.query.order_no,
      ebay_user_id: req.query.ebay_user_id,
      tracking_number: req.query.tracking_number,
      duty_status: req.query.duty_status,
      from_date: req.query.from_date,
      to_date: req.query.to_date,
    });
    return res.json({ orders, total });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
