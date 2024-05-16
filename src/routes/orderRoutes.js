// orderRoutes.js
const express = require('express');
const router = express.Router();
const { processOrdersAndBuyers, fetchOrdersFromEbay } = require('../services/orderService');

const orderController = require('../controllers/orderController');

// 特定のユーザーIDに紐づくすべての注文情報を取得
router.get('/user/:userId', orderController.getOrdersByUserId);

// 特定の注文情報を更新
router.put('/:orderId', orderController.updateOrder);

router.get('/sync-all-ebay-data/user/:userId', orderController.syncOrders);

// router.get('/sync-all-ebay-data', async (req, res) => {
//     try {
//         const accessToken = req.headers.authorization.split(' ')[1]; // Bearer Tokenからアクセストークンを抽出
//         const orders = await fetchOrdersFromEbay(accessToken);  // eBayから注文データを取得
//         await processOrdersAndBuyers(orders);  // 注文データとバイヤー情報を処理
//         res.status(200).send('Orders processed and saved successfully.');
//     } catch (error) {
//         console.error('Failed to process and save orders:', error);
//         res.status(500).json({ message: 'Failed to process and save orders', error: error.message });
//     }
// });

module.exports = router;
