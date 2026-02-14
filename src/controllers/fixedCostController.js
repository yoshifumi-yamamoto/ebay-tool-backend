const {
  listFixedCosts,
  createFixedCost,
  updateFixedCost,
  deleteFixedCost,
  getFixedCostSummary,
} = require('../services/fixedCostService');

exports.getFixedCosts = async (req, res) => {
  const { user_id } = req.query;
  try {
    const data = await listFixedCosts({ user_id });
    res.status(200).json({ fixed_costs: data });
  } catch (error) {
    console.error('Error fetching fixed costs:', error.message);
    res.status(500).json({ message: 'Failed to fetch fixed costs' });
  }
};

exports.createFixedCost = async (req, res) => {
  try {
    const created = await createFixedCost(req.body || {});
    res.status(201).json(created);
  } catch (error) {
    console.error('Error creating fixed cost:', error.message);
    res.status(500).json({ message: 'Failed to create fixed cost' });
  }
};

exports.updateFixedCost = async (req, res) => {
  const { id } = req.params;
  try {
    const updated = await updateFixedCost(id, req.body || {});
    res.status(200).json(updated);
  } catch (error) {
    console.error('Error updating fixed cost:', error.message);
    res.status(500).json({ message: 'Failed to update fixed cost' });
  }
};

exports.deleteFixedCost = async (req, res) => {
  const { id } = req.params;
  try {
    await deleteFixedCost(id);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error deleting fixed cost:', error.message);
    res.status(500).json({ message: 'Failed to delete fixed cost' });
  }
};

exports.getFixedCostSummary = async (req, res) => {
  const { user_id } = req.query;
  try {
    const summary = await getFixedCostSummary({ user_id });
    res.status(200).json(summary);
  } catch (error) {
    console.error('Error fetching fixed cost summary:', error.message);
    res.status(500).json({ message: 'Failed to fetch fixed cost summary' });
  }
};
