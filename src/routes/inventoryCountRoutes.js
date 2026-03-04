const express = require('express');
const inventoryCountController = require('../controllers/inventoryCountController');

const router = express.Router();

router.get('/', inventoryCountController.listInventoryCounts);
router.post('/', inventoryCountController.createInventoryCount);
router.get('/:id', inventoryCountController.getInventoryCount);
router.get('/:id/summary', inventoryCountController.getInventoryCountSummary);
router.post('/:id/rebuild-lines', inventoryCountController.rebuildInventoryCountLines);
router.post('/:id/freeze', inventoryCountController.freezeInventoryCount);
router.post('/:id/close', inventoryCountController.closeInventoryCount);
router.patch('/lines/:lineId', inventoryCountController.updateInventoryCountLine);

module.exports = router;
