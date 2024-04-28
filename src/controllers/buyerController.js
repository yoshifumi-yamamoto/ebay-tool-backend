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
