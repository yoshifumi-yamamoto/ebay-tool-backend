const express = require('express');
const { getTodayMetrics, getCarrierInvoiceHistory } = require('../controllers/ownerDashboardController');

const router = express.Router();

router.get('/today', getTodayMetrics);
router.get('/carrier-invoices', getCarrierInvoiceHistory);

module.exports = router;
