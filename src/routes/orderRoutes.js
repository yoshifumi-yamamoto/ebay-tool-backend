// orderRoutes.js
const express = require('express');
const router = express.Router();
const { processOrdersAndBuyers, fetchOrdersFromEbay } = require('../services/orderService');

const orderController = require('../controllers/orderController');

// GET orders by user ID
router.get('/orders', orderController.getOrdersByUserId);

router.get('/sync', async (req, res) => {
    try {
        const accessToken = req.headers.authorization.split(' ')[1]; // Bearer Tokenからアクセストークンを抽出
        const orders = await fetchOrdersFromEbay(accessToken);  // eBayから注文データを取得
        await processOrdersAndBuyers(orders);  // 注文データとバイヤー情報を処理
        res.status(200).send('Orders processed and saved successfully.');
    } catch (error) {
        console.error('Failed to process and save orders:', error);
        res.status(500).json({ message: 'Failed to process and save orders', error: error.message });
    }
});

module.exports = router;
