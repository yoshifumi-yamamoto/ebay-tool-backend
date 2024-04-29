const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');

router.get('/sync', orderController.syncOrders);

const orderService = require('../services/orderService');
const buyerService = require('../services/buyerService');

// 注文データを取得して保存するルート
router.get('/fetch-and-save-orders', async (req, res) => {
    try {
        const orders = await orderService.fetchOrdersFromEbay();  // eBayから注文データを取得
        const buyers = await buyerService.fetchAllBuyers(); // すべてのバイヤー情報を取得
        await orderService.saveOrdersToSupabase(orders, buyers);  // 取得したデータをSupabaseに保存
        res.status(200).send('Orders fetched and saved successfully.');
    } catch (error) {
        console.error('Failed to fetch and save orders:', error);
        res.status(500).json({ message: 'Failed to fetch and save orders NG', error: error.message });
    }
});

module.exports = router;