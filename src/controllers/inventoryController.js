// src/controllers/inventoryController.js
const { fetchInventoryUpdateHistory } = require('../services/inventoryService');

/**
 * 在庫更新履歴を取得するコントローラ関数
 * @param {object} req - リクエストオブジェクト
 * @param {object} res - レスポンスオブジェクト
 */
const getInventoryUpdateHistory = async (req, res) => {
  const { userId } = req.params;
  try {
      const data = await fetchInventoryUpdateHistory(userId);
      res.status(200).json(data);
  } catch (error) {
      res.status(500).send('Error fetching inventory update history');
  }
};

module.exports = { getInventoryUpdateHistory };
