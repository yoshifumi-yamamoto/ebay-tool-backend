const express = require('express');
const { getPackingVerification } = require('../controllers/packingVerificationController');

const router = express.Router();

router.get('/', getPackingVerification);

module.exports = router;
