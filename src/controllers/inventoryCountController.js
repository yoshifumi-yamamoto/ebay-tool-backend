const inventoryCountService = require('../services/inventoryCountService');

const resolveUserId = (req) => Number(req.query.user_id || req.query.userId || req.body?.user_id || req.body?.userId);

exports.listInventoryCounts = async (req, res) => {
  const userId = resolveUserId(req);
  if (!userId) return res.status(400).json({ error: 'user_id is required' });
  try {
    const result = await inventoryCountService.listInventoryCounts({
      userId,
      status: req.query.status,
      location_code: req.query.location_code,
      from_date: req.query.from_date,
      to_date: req.query.to_date,
      page: req.query.page,
      limit: req.query.limit,
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createInventoryCount = async (req, res) => {
  const userId = resolveUserId(req);
  if (!userId) return res.status(400).json({ error: 'user_id is required' });
  const { title, counted_at, location_code, created_by } = req.body || {};
  if (!counted_at || !location_code) {
    return res.status(400).json({ error: 'counted_at and location_code are required' });
  }
  try {
    const data = await inventoryCountService.createInventoryCount({
      userId,
      title,
      counted_at,
      location_code,
      created_by,
    });
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.rebuildInventoryCountLines = async (req, res) => {
  const userId = resolveUserId(req);
  if (!userId) return res.status(400).json({ error: 'user_id is required' });
  try {
    await inventoryCountService.rebuildInventoryCountLines({
      userId,
      inventoryCountId: req.params.id,
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.updateInventoryCountLine = async (req, res) => {
  const userId = resolveUserId(req);
  if (!userId) return res.status(400).json({ error: 'user_id is required' });
  try {
    const data = await inventoryCountService.updateInventoryCountLine({
      userId,
      lineId: req.params.lineId,
      counted_qty: req.body?.counted_qty,
      note: req.body?.note,
    });
    res.json(data);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.freezeInventoryCount = async (req, res) => {
  const userId = resolveUserId(req);
  if (!userId) return res.status(400).json({ error: 'user_id is required' });
  try {
    const data = await inventoryCountService.transitionInventoryCountStatus({
      userId,
      inventoryCountId: req.params.id,
      nextStatus: 'frozen',
    });
    res.json(data);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.closeInventoryCount = async (req, res) => {
  const userId = resolveUserId(req);
  if (!userId) return res.status(400).json({ error: 'user_id is required' });
  try {
    const data = await inventoryCountService.transitionInventoryCountStatus({
      userId,
      inventoryCountId: req.params.id,
      nextStatus: 'closed',
    });
    res.json(data);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.getInventoryCount = async (req, res) => {
  const userId = resolveUserId(req);
  if (!userId) return res.status(400).json({ error: 'user_id is required' });
  try {
    const result = await inventoryCountService.getInventoryCountById({
      userId,
      inventoryCountId: req.params.id,
      skuLike: req.query.skuLike || req.query.sku_like,
      diffOnly: String(req.query.diffOnly || req.query.diff_only || 'false') === 'true',
      page: req.query.page,
      limit: req.query.limit,
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.getInventoryCountSummary = async (req, res) => {
  const userId = resolveUserId(req);
  if (!userId) return res.status(400).json({ error: 'user_id is required' });
  try {
    const result = await inventoryCountService.getInventoryCountSummary({
      userId,
      inventoryCountId: req.params.id,
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
