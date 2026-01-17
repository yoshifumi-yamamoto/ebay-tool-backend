const { fetchOrdersFromEbay } = require('../services/orderService'); // orderService からメソッドをインポート
const buyerService = require('../services/buyerService');

exports.processOrdersAndBuyers = async (req, res) => {
    try {
        const orders = await fetchOrdersFromEbay(); // eBayから注文データを取得
        const result = await buyerService.processOrdersAndBuyers(orders);
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ message: "Failed to sync buyers", error: error.message });
    }
};

exports.getBuyersByUserId = async (req, res) => {
    try {
        const userId = req.query.userId;
        const includeStats = String(req.query.include_stats || '') === '1';
        const buyers = includeStats
            ? await buyerService.getBuyersByUserIdWithStats(userId)
            : await buyerService.getBuyersByUserId(userId);
        res.json(buyers);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getBuyerDetail = async (req, res) => {
    try {
        const buyerId = Number(req.params.buyerId);
        const userId = Number(req.query.userId || req.body?.user_id);
        if (!buyerId || !userId) {
            return res.status(400).json({ message: 'buyerId and userId are required' });
        }
        const detail = await buyerService.getBuyerDetailWithOrders(buyerId, userId);
        return res.json(detail);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};

exports.updateBuyer = async (req, res) => {
    try {
        const updatedBuyer = await buyerService.updateBuyer(req.params.buyerId, req.body);
        res.json(updatedBuyer);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
