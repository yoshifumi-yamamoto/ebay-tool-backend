// src/services/inventoryService.js
const { getInventoryUpdateHistoryByUserId } = require('../models/inventoryModel');
const octoparseService = require('./octoparseService');
const accountService = require('./accountService');
const itemService = require('./itemService');
const ebayService = require('./ebayService');
const supabase = require('../supabaseClient');


/**
 * 在庫更新履歴をユーザーIDで取得するサービス関数
 * @param {string} userId - ユーザーID
 * @returns {Promise<object>} - 取得した在庫更新履歴
 */
const fetchInventoryUpdateHistory = async (userId) => {
  return await getInventoryUpdateHistoryByUserId(userId);
};


// 在庫更新の主要なロジック
const processInventoryUpdate = async (userId, ebayUserId, taskId) => {
  try {
    // Octoparseのデータを取得
    const octoparseData = await octoparseService.fetchAllOctoparseData(userId, taskId);
    console.log('Octoparse data fetched:', octoparseData);

    // eBayアカウントのトークンを取得
    const ebayToken = await accountService.fetchEbayAccountTokens(ebayUserId);
    const accessToken = await accountService.refreshEbayToken(ebayToken[0]);

    // 在庫データを照合して更新
    const formattedData = await itemService.processDataAndFetchMatchingItems(octoparseData, ebayUserId);
    console.log('Formatted data:', formattedData);

    // 在庫情報をeBayに送信
    await ebayService.updateInventoryOnEbay(formattedData, accessToken);

    // 更新された在庫情報をSupabaseに保存
    for (const item of formattedData) {
      await supabase
        .from('items')
        .update({
          stock_status: item.stockStatus,
          last_update: new Date().toISOString()
        })
        .eq('ebay_item_id', item.itemId)
        .eq('user_id', userId);
    }

    console.log('在庫更新が完了しました');
  } catch (error) {
    console.error('在庫更新処理中にエラーが発生しました:', error);
  }
};

module.exports = {
  processInventoryUpdate,
  fetchInventoryUpdateHistory
};
