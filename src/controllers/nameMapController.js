const nameMapService = require('../services/nameMapService');

exports.listNameMaps = async (req, res) => {
  const userId = Number(req.query.user_id || req.query.userId);
  if (!userId) {
    return res.status(400).json({ error: 'user_id is required' });
  }
  try {
    const nameMaps = await nameMapService.listNameMaps(userId);
    return res.json({ nameMaps });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

exports.createNameMap = async (req, res) => {
  const userId = Number(req.body?.user_id || req.query?.user_id || req.query?.userId);
  if (!userId) {
    return res.status(400).json({ error: 'user_id is required' });
  }
  try {
    const nameMap = await nameMapService.createNameMap(userId, req.body || {});
    return res.status(201).json({ nameMap });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

exports.updateNameMap = async (req, res) => {
  const userId = Number(req.body?.user_id || req.query?.user_id || req.query?.userId);
  const { id } = req.params;
  if (!userId || !id) {
    return res.status(400).json({ error: 'user_id and id are required' });
  }
  try {
    const nameMap = await nameMapService.updateNameMap(userId, id, req.body || {});
    return res.json({ nameMap });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

exports.deleteNameMap = async (req, res) => {
  const userId = Number(req.body?.user_id || req.query?.user_id || req.query?.userId);
  const { id } = req.params;
  if (!userId || !id) {
    return res.status(400).json({ error: 'user_id and id are required' });
  }
  try {
    await nameMapService.deleteNameMap(userId, id);
    return res.status(204).send();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
