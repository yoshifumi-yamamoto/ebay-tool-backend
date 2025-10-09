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

// 注文明細の仕入ステータス更新
exports.updateProcurementStatus = async (req, res) => {
    const { lineItemId } = req.params;
    const { procurementStatus } = req.body;

    if (!procurementStatus) {
        return res.status(400).json({ error: 'procurementStatus is required' });
    }

    try {
        const updated = await orderService.updateProcurementStatus(lineItemId, procurementStatus);
        if (!updated) {
            return res.status(404).json({ error: 'Order line item not found' });
        }
        res.json(updated);
    } catch (error) {
        console.error('Failed to update procurement status:', error);
        res.status(500).json({ error: error.message });
    }
};

// 注文明細の仕入追跡番号更新
exports.updateProcurementTrackingNumber = async (req, res) => {
    const { lineItemId } = req.params;
    const { procurementTrackingNumber } = req.body;

    try {
        const updated = await orderService.updateProcurementTrackingNumber(lineItemId, procurementTrackingNumber ?? null);
        if (!updated) {
            return res.status(404).json({ error: 'Order line item not found' });
        }
        res.json(updated);
    } catch (error) {
        console.error('Failed to update procurement tracking number:', error);
        res.status(500).json({ error: error.message });
    }
};

// 発送ステータスを一括でSHIPPEDに更新
exports.markOrdersAsShipped = async (req, res) => {
    const { orderIds } = req.body;

    if (!Array.isArray(orderIds) || orderIds.length === 0) {
        return res.status(400).json({ error: 'orderIds must be a non-empty array' });
    }

    try {
        const updatedOrders = await orderService.markOrdersAsShipped(orderIds);
        res.json({ updatedOrders });
    } catch (error) {
        console.error('Failed to update shipping status to SHIPPED:', error);
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
        console.log('Request to update order:', orderId, orderData); // リクエストデータをログに記録

        const updatedOrder = await orderService.updateOrder(orderId, orderData);

        if (!updatedOrder) {
            console.error('Order not found:', orderId); // エラー詳細をログに記録
            return res.status(404).json({ error: 'Order not found' });
        }

        console.log('Order updated successfully:', updatedOrder); // 成功時の詳細をログに記録
        res.json(updatedOrder);
    } catch (error) {
        console.error('Update Order Error:', error); // エラー詳細をログに記録
        res.status(500).json({ error: error.message });
    }
};
