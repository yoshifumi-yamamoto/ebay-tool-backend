const express = require('express');
const router = express.Router();
const marketingController = require('../controllers/marketingController');

router.get('/send-offer/eligible', marketingController.getSendOfferEligible);
router.post('/send-offer/send', marketingController.sendOfferToInterestedBuyers);
router.get('/markdown/categories', marketingController.getMarkdownCategories);
router.get('/markdown/presets', marketingController.listMarkdownPresets);
router.post('/markdown/presets', marketingController.createMarkdownPreset);
router.put('/markdown/presets/:id', marketingController.updateMarkdownPreset);
router.delete('/markdown/presets/:id', marketingController.deleteMarkdownPreset);
router.post('/markdown/presets/preview', marketingController.previewMarkdownPresets);
router.post('/markdown/presets/execute', marketingController.executeMarkdownPresets);
router.post('/markdown/create', marketingController.createMarkdownSaleEvent);
router.post('/promoted/bulk-apply', marketingController.bulkApplyPromotedListings);

module.exports = router;
