const { fetchAllOctoparseData } = require('../services/octoparseService');
const { processDataAndFetchMatchingItems } = require('../services/itemService');

const getAllOctoparseData = async (req, res) => {
  const { userId, taskId } = req.query;
  try {
    const data = await fetchAllOctoparseData(userId, taskId);

    // eBayユーザーIDを指定（ここでは仮のIDを使用）
    const ebayUserId = "japangolfhub";

    // 取得したデータを元にmatchingItemsを取得
    const matchingItems = await processDataAndFetchMatchingItems(data, ebayUserId);
    console.log('Matching Items:', matchingItems); // 取得したmatchingItemsをログに出力

    res.status(200).json({ octoparseData: data, matchingItems });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching Octoparse data', error: error.message });
  }
};

module.exports = { getAllOctoparseData };
