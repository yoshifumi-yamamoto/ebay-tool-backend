const supabase = require('../supabaseClient');

/**
 * OctoparseタスクをユーザーIDで取得する関数
 * @param {string} userId - ユーザーID
 * @returns {Promise<object>} - 取得したタスクデータ
 */
const getOctoparseTasksByUserId = async (userId) => {
    const { data, error } = await supabase
        .from('octoparse_tasks')
        .select(`
            *,
            inventory_management_schedules (
                days_of_week,
                time_of_day,
                enabled,
                task_delete_flg
            )
        `)
        .eq('user_id', userId);
    if (error) throw error;
    return data;
};

/**
 * タスクIDでタスクを削除する関数
 * @param {string} taskId - タスクID
 * @returns {Promise<object>} - 削除されたタスクデータ
 */
const deleteTaskByID = async (taskId) => {
    const { data, error } = await supabase
        .from('octoparse_tasks')
        .delete()
        .eq('id', taskId);

    if (error) throw error;
    return data;
};

/**
 * 在庫管理フラグを更新する関数
 * @param {string} taskId - タスクID
 * @param {boolean} enabled - 在庫管理を有効にするかどうかのフラグ
 * @returns {Promise<object>} - 更新されたタスクデータ
 */
const updateInventoryManagementFlag = async (taskId, enabled) => {
    const { data, error } = await supabase
        .from('octoparse_tasks')
        .update({ inventory_management_enabled: enabled })
        .eq('id', taskId);

    if (error) throw error;
    return data;
};

module.exports = { getOctoparseTasksByUserId, deleteTaskByID, updateInventoryManagementFlag };
