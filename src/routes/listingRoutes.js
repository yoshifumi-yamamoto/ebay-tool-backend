const express = require('express');
const router = express.Router();
const listingController = require('../controllers/listingController');

// リスティングを同期するエンドポイント
router.get('/sync', listingController.syncListings);

module.exports = router;
