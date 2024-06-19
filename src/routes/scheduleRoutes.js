const express = require('express');
const { fetchSchedules, saveSchedule, updateScheduleStatus } = require('../controllers/scheduleController');
const { scheduleInventoryUpdates } = require('../scheduler');

const router = express.Router();

// スケジュールを取得するエンドポイント
router.get('/:taskId', fetchSchedules);

// スケジュールを保存するエンドポイント
router.post('/', async (req, res) => {
    try {
        await saveSchedule(req, res);
        await scheduleInventoryUpdates(); // スケジュール更新後にクーロンジョブを再設定
        console.log("cron jobs Updated!!")
    } catch (error) {
        console.error('Error saving schedule and rescheduling cron jobs:', error);
        res.status(500).send('Error saving schedule and rescheduling cron jobs');
    }
});

// スケジュールのステータスを更新するエンドポイント
router.put('/status/:taskId', async (req, res) => {
    try {
        await updateScheduleStatus(req, res);
        await scheduleInventoryUpdates(); // スケジュールステータス更新後にクーロンジョブを再設定
        console.log("cron jobs Updated!!")
    } catch (error) {
        console.error('Error updating schedule status and rescheduling cron jobs:', error);
        res.status(500).send('Error updating schedule status and rescheduling cron jobs');
    }
});

module.exports = router;
