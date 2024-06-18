const octoparseService = require('../services/octoparseService');
const { processDataAndFetchMatchingItems } = require('../services/itemService');

const getAllOctoparseData = async (req, res) => {
  const { userId, taskId } = req.query;
  try {
    const data = await octoparseService.fetchAllOctoparseData(userId, taskId);

    // eBayユーザーIDを指定（ここでは仮のIDを使用）
    const ebayUserId = "japangolfhub";

    // 取得したデータを元にmatchingItemsを取得
    const matchingItems = await processDataAndFetchMatchingItems(data, ebayUserId);
    console.log('Matching Items:', matchingItems); // 取得したmatchingItemsをログに出力

    res.status(200).json({ octoparseData: data, matchingItems });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching Octoparse data', error: error.message });
  }
}

  // 在庫管理フラグを更新するコントローラ関数
const updateInventoryManagementFlag = async (req, res) => {
  const { taskId, enabled } = req.body;

  try {
      await octoparseService.updateInventoryManagementFlag(taskId, enabled);
      res.status(200).send('Inventory management flag updated successfully');
  } catch (error) {
      console.error('Error updating inventory management flag:', error.message);
      res.status(500).send('Error updating inventory management flag');
  }
};

module.exports = { getAllOctoparseData, updateInventoryManagementFlag }
