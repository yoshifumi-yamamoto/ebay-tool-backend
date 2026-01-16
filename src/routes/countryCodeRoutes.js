const express = require('express');
const { getCountryCodes } = require('../controllers/countryCodeController');

const router = express.Router();

router.get('/', getCountryCodes);

module.exports = router;
