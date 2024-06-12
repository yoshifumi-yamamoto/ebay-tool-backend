const { createTask, completeTask, findTaskByID } = require('../services/taskService');

/**
 * タスクを保存するコントローラ関数
 * @param {object} req - リクエストオブジェクト
 * @param {object} res - レスポンスオブジェクト
 */
const saveTask = async (req, res) => {
  const { userID, ebayUserID, taskID, taskName } = req.body;
  try {
    const data = await createTask(userID, ebayUserID, taskID, taskName);
    res.status(200).send('Task saved successfully');
  } catch (error) {
    res.status(500).send('Error saving task');
  }
};

/**
 * タスクを完了とマークするコントローラ関数
 * @param {object} req - リクエストオブジェクト
 * @param {object} res - レスポンスオブジェクト
 */
const markTaskCompleted = async (req, res) => {
  const { taskID } = req.body;
  try {
    const data = await completeTask(taskID);
    res.status(200).send('Task marked as completed successfully');
  } catch (error) {
    res.status(500).send('Error marking task as completed');
  }
};

/**
 * タスクIDでタスクを取得するコントローラ関数
 * @param {object} req - リクエストオブジェクト
 * @param {object} res - レスポンスオブジェクト
 */
const getTask = async (req, res) => {
  const { taskID } = req.params;
  try {
    const task = await findTaskByID(taskID);
    res.status(200).json(task);
  } catch (error) {
    res.status(500).send('Error fetching task');
  }
};

module.exports = { saveTask, markTaskCompleted, getTask };
