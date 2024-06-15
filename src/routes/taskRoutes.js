// src/routes/taskRoutes.js
const express = require('express');
const { saveTask, markTaskCompleted, getTask, getOctoparseTasks, deleteTaskByID } = require('../controllers/taskController');
const router = express.Router();

/**
 * タスクを保存するルート
 */
router.post('/save-task', saveTask);

/**
 * タスクを完了とマークするルート
 */
router.post('/complete-task', markTaskCompleted);

/**
 * タスクIDでタスクを取得するルート
 */
router.get('/task/:taskID', getTask);

/**
 * ユーザーIDでOctoparseタスクを取得するルート
 */
router.get('/octoparse-tasks/:userId', getOctoparseTasks);

/**
 * タスクを削除するルート
 */
router.delete('/delete/:taskId', deleteTaskByID);

module.exports = router;
