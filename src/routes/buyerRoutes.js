const express = require('express');
const router = express.Router();
const buyerController = require('../controllers/buyerController');

router.get('/sync-buyers', buyerController.processOrdersAndBuyers);
router.get('/user', buyerController.getBuyersByUserId);
router.get('/:buyerId/detail', buyerController.getBuyerDetail);
router.put('/:buyerId', buyerController.updateBuyer);

module.exports = router;
