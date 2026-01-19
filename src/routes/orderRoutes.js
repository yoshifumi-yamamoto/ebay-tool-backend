const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');

// 特定のユーザーIDに紐づくすべての注文情報を取得
router.get('/user', orderController.getOrdersByUserId);
router.get('/by-order-no', orderController.getOrderByOrderNo);
router.get('/archived', orderController.getArchivedOrdersByUserId);

// 注文明細の仕入ステータス更新
router.put('/line-items/:lineItemId/procurement-status', orderController.updateProcurementStatus);

// 注文明細の追跡番号更新
router.put('/line-items/:lineItemId/procurement-tracking', orderController.updateProcurementTrackingNumber);

// 注文のeBay追跡情報アップロード
router.post('/:orderNo/tracking', orderController.uploadTrackingInfo);
router.post('/:orderNo/shipco/rates', orderController.estimateShipcoRates);
router.post('/:orderNo/shipco/label', orderController.createShipcoShipment);

// 発送ステータスを一括でSHIPPEDに更新
router.put('/shipping-status/bulk', orderController.markOrdersAsShipped);

// 特定の注文情報を更新
router.put('/:orderId', orderController.updateOrder);

// eBayデータを同期するルート
router.get('/sync-all-ebay-data/user/:userId', orderController.syncOrders);

module.exports = router;
