const supabase = require('../supabaseClient');

/**
 * タスクを保存する関数
 * @param {string} userID - ユーザーID
 * @param {string} ebayUserID - eBayユーザーID
 * @param {string} taskID - OctoparseのタスクID
 * @param {string} taskName - タスク名
 * @returns {Promise<object>} - 保存されたタスクのデータ
 */
const saveTask = async (userID, ebayUserID, taskID, taskName) => {
  try {
    const { data, error } = await supabase
      .from('octoparse_tasks')
      .insert([{ user_id: userID, ebay_user_id: ebayUserID, task_id: taskID, task_name: taskName }]);
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error saving task to Supabase:', error);
    throw error;
  }
};

/**
 * タスクの完了日時を更新する関数
 * @param {string} taskID - OctoparseのタスクID
 * @returns {Promise<object>} - 更新されたタスクのデータ
 */
const updateTaskCompletion = async (taskID) => {
  try {
    const { data, error } = await supabase
      .from('octoparse_tasks')
      .update({ completed_at: new Date().toISOString() }) // タスクの完了日時を現在の日時に更新
      .eq('task_id', taskID);
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error updating task completion in Supabase:', error);
    throw error;
  }
};

/**
 * タスクIDでタスクを取得する関数
 * @param {string} taskID - OctoparseのタスクID
 * @returns {Promise<object>} - タスクのデータ
 */
const getTaskByID = async (taskID) => {
  try {
    const { data, error } = await supabase
      .from('octoparse_tasks')
      .select('*')
      .eq('task_id', taskID);
    if (error) throw error;
    return data[0];
  } catch (error) {
    console.error('Error fetching task from Supabase:', error);
    throw error;
  }
};

module.exports = { saveTask, updateTaskCompletion, getTaskByID };