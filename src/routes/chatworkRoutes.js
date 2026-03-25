const express = require('express');
const router = express.Router();
const chatworkController = require('../controllers/chatworkController');

router.get('/last-week-orders/:userId', chatworkController.sendWeeklySalesInfo);
router.get('/procurement-alerts/:userId', chatworkController.sendProcurementAlertInfo);

module.exports = router;
