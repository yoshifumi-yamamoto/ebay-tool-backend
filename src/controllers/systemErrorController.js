const { listSystemErrors } = require('../services/systemErrorService');

exports.getSystemErrors = async (req, res) => {
  const {
    limit,
    user_id,
    account_id,
    provider,
    category,
    severity,
    error_code,
  } = req.query;

  const parsedLimit = limit ? Number(limit) : 50;
  const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : 50;

  try {
    const errors = await listSystemErrors({
      limit: safeLimit,
      user_id,
      account_id,
      provider,
      category,
      severity,
      error_code,
    });
    res.json({ errors });
  } catch (error) {
    console.error('Failed to fetch system errors:', error.message);
    res.status(500).json({ message: 'Failed to fetch system errors' });
  }
};
