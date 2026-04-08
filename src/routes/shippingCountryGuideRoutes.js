const express = require('express');
const {
  getShippingCountryGuides,
  patchShippingCountryGuide,
  getShippingCountryGuideSourceFile,
} = require('../controllers/shippingCountryGuideController');

const router = express.Router();

router.get('/', getShippingCountryGuides);
router.get('/source/:sourceKey', getShippingCountryGuideSourceFile);
router.patch('/:countryNameJa', patchShippingCountryGuide);

module.exports = router;
