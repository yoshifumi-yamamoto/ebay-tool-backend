// const { getTaskDetails, updateTaskSettings } = require('./octoparseService');
const { saveTask, updateTaskCompletion, getTaskByID } = require('../models/taskModel');
const { getOctoparseTasksByUserId, deleteTaskByID } = require('../models/octoparseTaskModel');

/**
 * ユーザーIDでOctoparseタスクを取得するサービス関数
 * @param {string} userId - ユーザーID
 * @returns {Promise<object>} - 取得したタスクデータ
 */
const fetchOctoparseTasks = async (userId) => {
  return await getOctoparseTasksByUserId(userId);
};

/**
 * タスクを作成するサービス関数
 * @param {string} userID - ユーザーID
 * @param {string} ebayUserID - eBayユーザーID
 * @param {string} taskID - OctoparseのタスクID
 * @param {string} taskName - タスク名
 * @returns {Promise<object>} - 作成されたタスクのデータ
 */
const createTask = async (userID, ebayUserID, taskID, taskName) => {
  return await saveTask(userID, ebayUserID, taskID, taskName);
};

/**
 * タスクIDでタスクを削除するサービス関数
 * @param {string} taskId - タスクID
 * @returns {Promise<object>} - 削除されたタスクのデータ
 */
const deleteTask = async (taskId) => {
  return await deleteTaskByID(taskId);
};

/**
 * タスクを完了とマークするサービス関数
 * @param {string} taskID - OctoparseのタスクID
 * @returns {Promise<object>} - 完了とマークされたタスクのデータ
 */
const completeTask = async (taskID) => {
  return await updateTaskCompletion(taskID);
};

/**
 * タスクIDでタスクを見つけるサービス関数
 * @param {string} taskID - OctoparseのタスクID
 * @returns {Promise<object>} - タスクのデータ
 */
const findTaskByID = async (taskID) => {
  return await getTaskByID(taskID);
};

module.exports = { fetchOctoparseTasks, createTask, deleteTask, completeTask, findTaskByID };
