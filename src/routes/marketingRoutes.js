const express = require('express');
const router = express.Router();
const marketingController = require('../controllers/marketingController');

router.get('/send-offer/eligible', marketingController.getSendOfferEligible);

module.exports = router;
