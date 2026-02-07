const employeeService = require('../services/employeeService');

exports.listEmployees = async (req, res) => {
  const userId = Number(req.query.user_id || req.query.userId);
  if (!userId) {
    return res.status(400).json({ error: 'user_id is required' });
  }
  try {
    const employees = await employeeService.listEmployees(userId);
    return res.json({ employees });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

exports.createEmployee = async (req, res) => {
  const userId = Number(req.body?.user_id || req.query?.user_id || req.query?.userId);
  if (!userId) {
    return res.status(400).json({ error: 'user_id is required' });
  }
  try {
    const employee = await employeeService.createEmployee(userId, req.body || {});
    return res.status(201).json({ employee });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

exports.updateEmployee = async (req, res) => {
  const userId = Number(req.body?.user_id || req.query?.user_id || req.query?.userId);
  const { id } = req.params;
  if (!userId || !id) {
    return res.status(400).json({ error: 'user_id and id are required' });
  }
  try {
    const employee = await employeeService.updateEmployee(userId, id, req.body || {});
    return res.json({ employee });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

exports.deleteEmployee = async (req, res) => {
  const userId = Number(req.body?.user_id || req.query?.user_id || req.query?.userId);
  const { id } = req.params;
  if (!userId || !id) {
    return res.status(400).json({ error: 'user_id and id are required' });
  }
  try {
    await employeeService.deleteEmployee(userId, id);
    return res.status(204).send();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
