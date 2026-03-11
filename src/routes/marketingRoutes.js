const express = require('express');
const router = express.Router();
const marketingController = require('../controllers/marketingController');

router.get('/send-offer/eligible', marketingController.getSendOfferEligible);
router.post('/send-offer/send', marketingController.sendOfferToInterestedBuyers);
router.get('/markdown/categories', marketingController.getMarkdownCategories);
router.post('/markdown/create', marketingController.createMarkdownSaleEvent);
router.post('/promoted/bulk-apply', marketingController.bulkApplyPromotedListings);

module.exports = router;
