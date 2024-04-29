const express = require('express');
const router = express.Router();
const buyerController = require('../controllers/buyerController');

router.get('/sync-buyers', buyerController.processOrdersAndBuyers);
router.get('/', buyerController.getAllBuyers);

module.exports = router;
