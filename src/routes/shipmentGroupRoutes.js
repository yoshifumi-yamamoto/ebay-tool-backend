const express = require('express');
const shipmentGroupController = require('../controllers/shipmentGroupController');

const router = express.Router();

router.get('/', shipmentGroupController.listShipmentGroups);
router.post('/', shipmentGroupController.createShipmentGroup);
router.post('/:id/rates', shipmentGroupController.estimateRates);
router.post('/:id/ship', shipmentGroupController.createShipment);

module.exports = router;
