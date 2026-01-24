const express = require('express');
const { getTodayAiInsight, getAiInsightHistory } = require('../controllers/dashboardInsightController');

const router = express.Router();

router.post('/today/ai-insight', getTodayAiInsight);
router.get('/today/ai-insight/history', getAiInsightHistory);

module.exports = router;
