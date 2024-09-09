const express = require('express');
const router = express.Router();
const listingController = require('../controllers/listingController');

// リスティングを同期するエンドポイント
router.get('/sync', listingController.syncListings);
router.get('/sync-ended-listings', listingController.syncEndedListings);

module.exports = router;
