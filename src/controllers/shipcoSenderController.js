const shipcoSenderService = require('../services/shipcoSenderService');

exports.getSender = async (req, res) => {
  const userId = Number(req.query.user_id || req.query.userId || req.body?.user_id);
  if (!userId) {
    return res.status(400).json({ error: 'user_id is required' });
  }
  try {
    const sender = await shipcoSenderService.getSenderByUserId(userId);
    return res.status(200).json({ sender });
  } catch (error) {
    console.error('Failed to fetch Ship&Co sender:', error.message);
    return res.status(500).json({ error: 'Failed to fetch sender' });
  }
};

exports.saveSender = async (req, res) => {
  const userId = Number(req.body?.user_id || req.query?.user_id || req.query?.userId);
  if (!userId) {
    return res.status(400).json({ error: 'user_id is required' });
  }
  try {
    const sender = await shipcoSenderService.upsertSender(userId, req.body || {});
    return res.status(200).json({ sender });
  } catch (error) {
    console.error('Failed to save Ship&Co sender:', error.message);
    return res.status(500).json({ error: 'Failed to save sender' });
  }
};
