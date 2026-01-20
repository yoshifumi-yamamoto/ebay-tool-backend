const htsCodeService = require('../services/htsCodeService');

exports.listHtsCodes = async (req, res) => {
  const userId = Number(req.query.user_id || req.query.userId);
  if (!userId) {
    return res.status(400).json({ error: 'user_id is required' });
  }
  try {
    const codes = await htsCodeService.listHtsCodes(userId);
    return res.json({ codes });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

exports.createHtsCode = async (req, res) => {
  const userId = Number(req.body?.user_id || req.query?.user_id || req.query?.userId);
  if (!userId) {
    return res.status(400).json({ error: 'user_id is required' });
  }
  try {
    const code = await htsCodeService.createHtsCode(userId, req.body || {});
    return res.status(201).json({ code });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

exports.updateHtsCode = async (req, res) => {
  const userId = Number(req.body?.user_id || req.query?.user_id || req.query?.userId);
  const { id } = req.params;
  if (!userId || !id) {
    return res.status(400).json({ error: 'user_id and id are required' });
  }
  try {
    const code = await htsCodeService.updateHtsCode(userId, id, req.body || {});
    return res.json({ code });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

exports.deleteHtsCode = async (req, res) => {
  const userId = Number(req.body?.user_id || req.query?.user_id || req.query?.userId);
  const { id } = req.params;
  if (!userId || !id) {
    return res.status(400).json({ error: 'user_id and id are required' });
  }
  try {
    await htsCodeService.deleteHtsCode(userId, id);
    return res.status(204).send();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
