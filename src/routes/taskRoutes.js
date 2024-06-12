const express = require('express');
const { saveTask, markTaskCompleted, getTask } = require('../controllers/taskController');
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

module.exports = router;
