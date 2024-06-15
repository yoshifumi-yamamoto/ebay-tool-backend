// src/services/inventoryService.js
const { getInventoryUpdateHistoryByUserId } = require('../models/inventoryModel');

/**
 * 在庫更新履歴をユーザーIDで取得するサービス関数
 * @param {string} userId - ユーザーID
 * @returns {Promise<object>} - 取得した在庫更新履歴
 */
const fetchInventoryUpdateHistory = async (userId) => {
  return await getInventoryUpdateHistoryByUserId(userId);
};

module.exports = { fetchInventoryUpdateHistory };
