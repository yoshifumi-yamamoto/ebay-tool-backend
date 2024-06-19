const express = require('express');
const { fetchSchedules, saveSchedule, updateScheduleStatus } = require('../controllers/scheduleController');

const router = express.Router();

// スケジュールを取得するエンドポイント
router.get('/:taskId', fetchSchedules);

// スケジュールを保存するエンドポイント
router.post('/', saveSchedule);

// enabledステータスを更新するエンドポイント
router.put('/status/:taskId', updateScheduleStatus);

module.exports = router;
