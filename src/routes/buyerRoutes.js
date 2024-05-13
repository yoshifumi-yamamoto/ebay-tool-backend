const express = require('express');
const router = express.Router();
const buyerController = require('../controllers/buyerController');

router.get('/sync-buyers', buyerController.processOrdersAndBuyers);
router.get('/user/:userId', buyerController.getBuyersByUserId);
router.put('/:buyerId', buyerController.updateBuyer);

module.exports = router;
