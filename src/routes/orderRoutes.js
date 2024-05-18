const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');

// 特定のユーザーIDに紐づくすべての注文情報を取得
router.get('/user', orderController.getOrdersByUserId);

// 特定の注文情報を更新
router.put('/:orderId', orderController.updateOrder);

// eBayデータを同期するルート
router.get('/sync-all-ebay-data/user/:userId', orderController.syncOrders);

module.exports = router;