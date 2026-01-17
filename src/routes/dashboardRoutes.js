const express = require('express');
const { getTodayAiInsight } = require('../controllers/dashboardInsightController');

const router = express.Router();

router.post('/today/ai-insight', getTodayAiInsight);

module.exports = router;
