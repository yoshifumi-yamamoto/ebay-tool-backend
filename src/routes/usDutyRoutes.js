const express = require('express');
const router = express.Router();
const usDutyController = require('../controllers/usDutyController');

router.get('/us-orders', usDutyController.getUsDutyOrders);

module.exports = router;
