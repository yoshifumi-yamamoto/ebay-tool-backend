const orderService = require('../services/orderService');
const orderShipcoService = require('../services/orderShipcoService');
const { logSystemError } = require('../services/systemErrorService');

// eBayの注文とバイヤー情報を同期
exports.syncOrders = async (req, res) => {
    const userId = req.params.userId; // ユーザーIDはリクエストから取得する
    try {
        await orderService.saveOrdersAndBuyers(userId);
        const relevantOrders = await orderService.fetchRelevantOrders(userId); // 関連する注文を取得
        res.json(relevantOrders);
    } catch (error) {
        console.error('Failed to sync orders:', error);
        await logSystemError({
            error_code: 'ORDER_SYNC_FAILED',
            category: 'EXTERNAL',
            severity: 'ERROR',
            provider: 'ebay',
            message: error.message,
            retryable: true,
            user_id: userId,
        });
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
        await logSystemError({
            error_code: 'PROCUREMENT_STATUS_UPDATE_FAILED',
            category: 'DB',
            severity: 'ERROR',
            provider: 'supabase',
            message: error.message,
            retryable: false,
            payload_summary: { lineItemId, procurementStatus },
        });
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
        await logSystemError({
            error_code: 'PROCUREMENT_TRACKING_UPDATE_FAILED',
            category: 'DB',
            severity: 'ERROR',
            provider: 'supabase',
            message: error.message,
            retryable: false,
            payload_summary: { lineItemId },
        });
        res.status(500).json({ error: error.message });
    }
};

exports.uploadTrackingInfo = async (req, res) => {
    const { orderNo } = req.params;
    const {
        trackingNumber,
        carrierCode,
        shippingServiceCode,
        shippedDate,
        lineItems,
    } = req.body || {};

    if (!trackingNumber || !carrierCode) {
        return res.status(400).json({ error: 'trackingNumber and carrierCode are required' });
    }

    try {
        const updatedOrder = await orderService.uploadTrackingInfoToEbay({
            orderNo,
            trackingNumber,
            carrierCode,
            shippingServiceCode,
            shippedDate,
            lineItems,
        });
        res.json(updatedOrder);
    } catch (error) {
        console.error('Failed to upload tracking info to eBay:', error);
        await logSystemError({
            error_code: 'EBAY_TRACKING_UPLOAD_FAILED',
            category: 'EXTERNAL',
            severity: 'ERROR',
            provider: 'ebay',
            message: error.message,
            retryable: true,
            payload_summary: { orderNo },
        });
        res.status(500).json({ error: error.message });
    }
};

exports.estimateShipcoRates = async (req, res) => {
    const orderNo = req.params.orderNo;
    const userId = Number(req.body?.user_id || req.query?.user_id || req.query?.userId);
    if (!orderNo) {
        return res.status(400).json({ error: 'orderNo is required' });
    }
    if (!userId) {
        return res.status(400).json({ error: 'user_id is required' });
    }
    try {
        const result = await orderShipcoService.estimateRates(orderNo, userId, req.body || {});
        const rates = Array.isArray(result?.rates) ? result.rates : [];
        const errors = Array.isArray(result?.errors) ? result.errors : [];
        return res.status(200).json({ rates, errors });
    } catch (error) {
        console.error('Failed to estimate Ship&Co rates:', error.message);
        return res.status(500).json({ error: 'Failed to estimate Ship&Co rates' });
    }
};

exports.createShipcoShipment = async (req, res) => {
    const orderNo = req.params.orderNo;
    const userId = Number(req.body?.user_id || req.query?.user_id || req.query?.userId);
    if (!orderNo) {
        return res.status(400).json({ error: 'orderNo is required' });
    }
    if (!userId) {
        return res.status(400).json({ error: 'user_id is required' });
    }
    try {
        const result = await orderShipcoService.createShipment(orderNo, userId, req.body || {});
        return res.status(200).json(result);
    } catch (error) {
        console.error('Failed to create Ship&Co shipment:', error.message);
        return res.status(500).json({ error: 'Failed to create Ship&Co shipment' });
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
        await logSystemError({
            error_code: 'ORDER_SHIPPING_STATUS_BULK_FAILED',
            category: 'DB',
            severity: 'ERROR',
            provider: 'supabase',
            message: error.message,
            retryable: false,
            payload_summary: { orderIds },
        });
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
        await logSystemError({
            error_code: 'ORDER_FETCH_FAILED',
            category: 'DB',
            severity: 'ERROR',
            provider: 'supabase',
            message: error.message,
            retryable: true,
            user_id: userId,
        });
        res.status(500).json({ error: error.message });
    }
};

// キャンセル/返金済みの注文一覧
exports.getArchivedOrdersByUserId = async (req, res) => {
    const userId = req.query.userId;
    const status = req.query.status || null;
    if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
    }
    try {
        const orders = await orderService.fetchArchivedOrders(userId, status);
        res.json(orders);
    } catch (error) {
        await logSystemError({
            error_code: 'ORDER_ARCHIVED_FETCH_FAILED',
            category: 'DB',
            severity: 'ERROR',
            provider: 'supabase',
            message: error.message,
            retryable: true,
            user_id: userId,
        });
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
        await logSystemError({
            error_code: 'ORDER_UPDATE_FAILED',
            category: 'DB',
            severity: 'ERROR',
            provider: 'supabase',
            message: error.message,
            retryable: false,
            payload_summary: { orderId },
        });
        res.status(500).json({ error: error.message });
    }
};
