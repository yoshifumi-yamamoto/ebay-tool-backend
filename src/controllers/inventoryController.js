const { fetchInventoryUpdateHistory, processInventoryUpdate } = require('../services/inventoryService');

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

/**
 * 在庫更新を処理するコントローラ関数
 * @param {object} req - リクエストオブジェクト
 * @param {object} res - レスポンスオブジェクト
 */
const updateInventory = async (req, res) => {
  const { userId, ebayUserId, taskId, folderId } = req.body;

  try {
    // 在庫更新の処理を呼び出し
    await processInventoryUpdate(userId, ebayUserId, taskId, folderId);
    res.status(200).send('Inventory updated successfully');
  } catch (error) {
    console.error('Error updating inventory:', error.message);
    res.status(500).send('Error updating inventory');
  }
};

module.exports = { getInventoryUpdateHistory, updateInventory };
