// const { getTaskDetails, updateTaskSettings } = require('./octoparseService');
const { saveTask, updateTaskCompletion, getTaskByID } = require('../models/taskModel');

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

module.exports = { createTask, completeTask, findTaskByID };
