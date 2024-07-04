const express = require('express');
const router = express.Router();
const { getOrders, getOrderSummary, downloadOrderSummaryCSV } = require('../controllers/orderSummaryController');

router.get('/', getOrders);
router.get('/summary', getOrderSummary);
router.get('/download-csv', downloadOrderSummaryCSV);

module.exports = router;
