// src/models/inventoryModel.js
const supabase = require('../supabaseClient');

/**
 * 在庫更新履歴をユーザーIDで取得する関数
 * @param {string} userId - ユーザーID
 * @returns {Promise<object>} - 取得した在庫更新履歴データ
 */
const getInventoryUpdateHistoryByUserId = async (userId) => {
    const { data, error } = await supabase
        .from('inventory_update_history')
        .select('*')
        .eq('user_id', userId);

    if (error) throw error;
    return data;
};

module.exports = { getInventoryUpdateHistoryByUserId };
