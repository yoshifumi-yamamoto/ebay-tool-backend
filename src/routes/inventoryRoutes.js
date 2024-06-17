const express = require('express');
const router = express.Router();
const { getInventoryUpdateHistory, updateInventory } = require('../controllers/inventoryController');

// 在庫更新履歴の取得ルート
router.get('/inventory-update-history/:userId', getInventoryUpdateHistory);

// 在庫更新の処理ルート
router.post('/update', updateInventory);

module.exports = router;
