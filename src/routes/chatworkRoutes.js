const express = require('express');
const router = express.Router();
const chatworkController = require('../controllers/chatworkController');

router.get('/last-week-orders/:userId', chatworkController.sendWeeklySalesInfo);

module.exports = router;
