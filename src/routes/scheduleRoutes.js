const express = require('express');
const { fetchSchedules, saveSchedule } = require('../controllers/scheduleController');

const router = express.Router();

// スケジュールを取得するエンドポイント
router.get('/:taskId', fetchSchedules);

// スケジュールを保存するエンドポイント
router.post('/', saveSchedule);

module.exports = router;
