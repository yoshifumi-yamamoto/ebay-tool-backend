const express = require('express');
const router = express.Router();
const fixedCostController = require('../controllers/fixedCostController');

router.get('/', fixedCostController.getFixedCosts);
router.get('/summary', fixedCostController.getFixedCostSummary);
router.post('/', fixedCostController.createFixedCost);
router.put('/:id', fixedCostController.updateFixedCost);
router.delete('/:id', fixedCostController.deleteFixedCost);

module.exports = router;
