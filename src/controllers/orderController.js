const orderService = require('../services/orderService');

exports.syncOrders = async (req, res) => {
    try {
        const orders = await orderService.fetchOrdersFromEbay();
        await orderService.saveOrdersToSupabase(orders);
        res.status(200).send('Orders synced successfully');
    } catch (error) {
        console.error('Failed to sync orders:', error);
        res.status(500).json({ error: error.message });
    }
};
