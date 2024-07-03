const express = require('express');
const router = express.Router();
const { getOrders, getOrderSummary } = require('../controllers/orderSummaryController');

router.get('/', getOrders);
router.get('/summary', getOrderSummary);

module.exports = router;
