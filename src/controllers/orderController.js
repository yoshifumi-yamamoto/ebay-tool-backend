const orderService = require('../services/orderService');
const buyerService = require('../services/buyerService'); // buyerServiceのインポート

// exports.syncOrders = async (req, res) => {
//     try {
//         const orders = await orderService.fetchOrdersFromEbay(); // eBayから注文データを取得
//         const buyers = await buyerService.fetchAllBuyers(); // すべてのバイヤー情報を取得
//         console.log("syncOrders",buyers)
//         await orderService.saveOrdersToSupabase(orders, buyers); // 注文データとバイヤー情報を処理
//         res.status(200).send('Orders and buyers processed successfully');
//     } catch (error) {
//         console.error('Failed to sync orders:', error);
//         res.status(500).json({ error: error.message });
//     }
// };

// eBayの注文とバイヤー情報を同期するコントローラー関数
exports.syncOrders = async (req, res) => {
    const userId = req.params.userId; // ユーザーIDはリクエストから取得する
    try {
        await orderService.saveOrdersAndBuyers(userId);
        res.status(200).send('Orders and buyers processed successfully');
    } catch (error) {
        console.error('Failed to sync orders:', error);
        res.status(500).json({ error: error.message });
    }
};



exports.getOrdersByUserId = async (req, res) => {
    const userId = req.query.userId;
    if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
    }
    try {
        const orders = await orderService.getOrdersByUserId(userId);
        res.json(orders);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.updateOrder = async (req, res) => {
    try {
        const updatedOrder = await orderService.updateOrder(req.params.orderId, req.body);
        res.json(updatedOrder);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
