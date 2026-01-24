const { generateTodayAiInsight, fetchAiInsightHistory } = require('../services/dashboardInsightService');

const rateLimitSeconds = Number(process.env.AI_INSIGHT_RATE_LIMIT_SECONDS) || 30;
const lastRequestByUser = new Map();

const isRateLimited = (userId) => {
  if (!userId) return false;
  const now = Date.now();
  const last = lastRequestByUser.get(userId) || 0;
  if (now - last < rateLimitSeconds * 1000) {
    return true;
  }
  lastRequestByUser.set(userId, now);
  return false;
};

exports.getTodayAiInsight = async (req, res) => {
  const userId = Number(req.body?.user_id || req.query?.user_id);
  const date = req.body?.date || null;

  if (!userId) {
    return res.status(400).json({ error: 'user_id is required' });
  }
  if (isRateLimited(userId)) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  try {
    const result = await generateTodayAiInsight({ userId, date });
    return res.status(200).json(result);
  } catch (error) {
    console.error('[dashboardInsight] Failed to generate AI insight:', error.message);
    return res.status(500).json({ error: 'Failed to generate AI insight' });
  }
};

exports.getAiInsightHistory = async (req, res) => {
  const userId = Number(req.query?.user_id || req.body?.user_id);
  const fromDay = req.query?.from_day || null;
  const toDay = req.query?.to_day || null;
  const limit = Number(req.query?.limit || 30);

  if (!userId) {
    return res.status(400).json({ error: 'user_id is required' });
  }
  if (Number.isNaN(limit) || limit <= 0) {
    return res.status(400).json({ error: 'limit must be a positive number' });
  }

  try {
    const rows = await fetchAiInsightHistory({ userId, fromDay, toDay, limit });
    return res.status(200).json({ items: rows });
  } catch (error) {
    console.error('[dashboardInsight] Failed to fetch AI insight history:', error.message);
    return res.status(500).json({ error: 'Failed to fetch AI insight history' });
  }
};
