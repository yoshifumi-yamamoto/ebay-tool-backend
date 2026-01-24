const express = require('express');
const { getPackingVerification, getCarrierRates, syncCarrierRates } = require('../controllers/packingVerificationController');

const router = express.Router();

router.get('/', getPackingVerification);
router.get('/carrier-rates', getCarrierRates);
router.post('/carrier-rates/sync', syncCarrierRates);

module.exports = router;
