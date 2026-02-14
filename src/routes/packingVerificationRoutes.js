const express = require('express');
const { getPackingVerification, getCarrierRates, syncCarrierRates, downloadCarrierRatesCsv } = require('../controllers/packingVerificationController');

const router = express.Router();

router.get('/', getPackingVerification);
router.get('/carrier-rates', getCarrierRates);
router.get('/carrier-rates/csv', downloadCarrierRatesCsv);
router.post('/carrier-rates/sync', syncCarrierRates);

module.exports = router;
