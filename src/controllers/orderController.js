const orderService = require('../services/orderService');

// eBayの注文とバイヤー情報を同期
exports.syncOrders = async (req, res) => {
    const userId = req.params.userId; // ユーザーIDはリクエストから取得する
    try {
        await orderService.saveOrdersAndBuyers(userId);
        const relevantOrders = await orderService.fetchRelevantOrders(userId); // 関連する注文を取得
        res.json(relevantOrders);
    } catch (error) {
        console.error('Failed to sync orders:', error);
        res.status(500).json({ error: error.message });
    }
};


// userに紐づく全注文情報の取得
exports.getOrdersByUserId = async (req, res) => {
    const userId = req.query.userId;
    if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
    }
    try {
        const orders = await orderService.fetchRelevantOrders(userId);
        res.json(orders);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// 注文情報の更新
exports.updateOrder = async (req, res) => {
    try {
        const orderId = req.params.orderId;
        const orderData = req.body;
        const updatedOrder = await orderService.updateOrder(orderId, orderData);
        if (!updatedOrder) {
            return res.status(404).json({ error: 'Order not found' });
        }
        res.json(updatedOrder);
    } catch (error) {
        console.error('Update Order Error:', error); // デバッグ用に追加
        res.status(500).json({ error: error.message });
    }
};
