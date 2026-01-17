const express = require('express');
const shipcoSenderController = require('../controllers/shipcoSenderController');

const router = express.Router();

router.get('/sender', shipcoSenderController.getSender);
router.post('/sender', shipcoSenderController.saveSender);

module.exports = router;
