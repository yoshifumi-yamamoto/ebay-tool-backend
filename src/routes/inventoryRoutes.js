// src/routes/inventoryRoutes.js
const express = require('express');
const { getInventoryUpdateHistory } = require('../controllers/inventoryController');
const router = express.Router();

/**
 * ユーザーIDで在庫更新履歴を取得するルート
 */
router.get('/inventory-update-history/:userId', getInventoryUpdateHistory);

module.exports = router;
