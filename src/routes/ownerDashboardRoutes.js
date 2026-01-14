const express = require('express');
const { getTodayMetrics } = require('../controllers/ownerDashboardController');

const router = express.Router();

router.get('/today', getTodayMetrics);

module.exports = router;
