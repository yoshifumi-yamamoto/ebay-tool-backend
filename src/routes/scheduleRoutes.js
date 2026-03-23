const express = require('express');
const { fetchSchedules, saveSchedule, updateScheduleStatus } = require('../controllers/scheduleController');

const router = express.Router();

// スケジュールを取得するエンドポイント
router.get('/:taskId', fetchSchedules);

// スケジュールを保存するエンドポイント
router.post('/', async (req, res) => {
    try {
        await saveSchedule(req, res);
    } catch (error) {
        console.error('Error saving schedule:', error);
        res.status(500).send('Error saving schedule');
    }
});

// スケジュールのステータスを更新するエンドポイント
router.put('/status/:taskId', async (req, res) => {
    try {
        await updateScheduleStatus(req, res);
    } catch (error) {
        console.error('Error updating schedule status:', error);
        res.status(500).send('Error updating schedule status');
    }
});

module.exports = router;
