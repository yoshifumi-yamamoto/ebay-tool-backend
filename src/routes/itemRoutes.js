const express = require('express');
const router = express.Router();
const itemsController = require('../controllers/itemsController');

router.post('/sync-active-listings', itemsController.syncActiveListings);

module.exports = router;
