const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');

router.get('/', webhookController.listWebhooks);
router.post('/', webhookController.createWebhook);

module.exports = router;
