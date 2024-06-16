const { fetchAllOctoparseData } = require('../services/octoparseService');

const getAllOctoparseData = async (req, res) => {
  const { userId, taskId } = req.query;
  try {
    const data = await fetchAllOctoparseData(userId, taskId);
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching Octoparse data', error: error.message });
  }
};

module.exports = { getAllOctoparseData };
