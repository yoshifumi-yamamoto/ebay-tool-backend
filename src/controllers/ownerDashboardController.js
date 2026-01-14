const { fetchTodayMetrics } = require('../services/ownerDashboardService');

exports.getTodayMetrics = async (req, res) => {
  const userId = Number(req.query.user_id || req.query.userId);
  const fromDay = req.query.from_day || req.query.fromDay;
  const toDay = req.query.to_day || req.query.toDay;

  if (!userId || !fromDay || !toDay) {
    return res.status(400).json({ error: 'user_id, from_day, to_day are required' });
  }

  try {
    const metrics = await fetchTodayMetrics({ userId, fromDay, toDay });
    return res.status(200).json(metrics);
  } catch (error) {
    console.error('[ownerDashboard] Failed to fetch today metrics:', error.message);
    return res.status(500).json({ error: 'Failed to fetch today metrics' });
  }
};
