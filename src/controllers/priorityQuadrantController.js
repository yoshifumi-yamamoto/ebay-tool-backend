const {
  listQuadrants,
  createQuadrant,
  updateQuadrant,
  deleteQuadrant,
  listMemos,
  upsertMemo,
  deleteMemo,
} = require('../services/priorityQuadrantService');

exports.getQuadrants = async (req, res) => {
  const { user_id } = req.query;
  try {
    const data = await listQuadrants({ user_id });
    res.status(200).json({ items: data });
  } catch (error) {
    console.error('Error fetching quadrants:', error.message);
    res.status(500).json({ message: 'Failed to fetch quadrants' });
  }
};

exports.createQuadrant = async (req, res) => {
  try {
    const created = await createQuadrant(req.body || {});
    res.status(201).json(created);
  } catch (error) {
    console.error('Error creating quadrant:', error.message);
    res.status(500).json({ message: 'Failed to create quadrant' });
  }
};

exports.updateQuadrant = async (req, res) => {
  const { id } = req.params;
  try {
    const updated = await updateQuadrant(id, req.body || {});
    res.status(200).json(updated);
  } catch (error) {
    console.error('Error updating quadrant:', error.message);
    res.status(500).json({ message: 'Failed to update quadrant' });
  }
};

exports.deleteQuadrant = async (req, res) => {
  const { id } = req.params;
  try {
    await deleteQuadrant(id);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error deleting quadrant:', error.message);
    res.status(500).json({ message: 'Failed to delete quadrant' });
  }
};

exports.getMemos = async (req, res) => {
  const { user_id } = req.query;
  try {
    const data = await listMemos({ user_id });
    res.status(200).json({ memos: data });
  } catch (error) {
    console.error('Error fetching memos:', error.message);
    res.status(500).json({ message: 'Failed to fetch memos' });
  }
};

exports.upsertMemo = async (req, res) => {
  try {
    const saved = await upsertMemo(req.body || {});
    res.status(200).json(saved);
  } catch (error) {
    console.error('Error saving memo:', error.message);
    res.status(500).json({ message: 'Failed to save memo' });
  }
};

exports.deleteMemo = async (req, res) => {
  const { id } = req.params;
  try {
    await deleteMemo(id);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error deleting memo:', error.message);
    res.status(500).json({ message: 'Failed to delete memo' });
  }
};
