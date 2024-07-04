const express = require('express');
const router = express.Router();
const { getListingsSummary, downloadListingsSummaryCSV } = require('../controllers/listingsSummaryController');

router.get('/', getListingsSummary);
router.get('/download-csv', downloadListingsSummaryCSV);

module.exports = router;
