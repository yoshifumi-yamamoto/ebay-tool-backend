const shipmentGroupService = require('../services/shipmentGroupService');

async function listShipmentGroups(req, res) {
    const userId = Number(req.query.user_id || req.query.userId);
    const status = req.query.status || 'draft';
    if (!userId) {
        return res.status(400).json({ error: 'user_id is required' });
    }
    try {
        const groups = await shipmentGroupService.listShipmentGroups(userId, status);
        res.status(200).json({ groups });
    } catch (error) {
        console.error('Failed to list shipment groups:', error.message);
        res.status(500).json({ error: 'Failed to list shipment groups' });
    }
}

async function createShipmentGroup(req, res) {
    const { user_id, order_nos, primary_order_no } = req.body || {};
    const userId = Number(user_id);
    if (!userId) {
        return res.status(400).json({ error: 'user_id is required' });
    }
    if (!Array.isArray(order_nos) || order_nos.length === 0) {
        return res.status(400).json({ error: 'order_nos is required' });
    }
    try {
        const group = await shipmentGroupService.createShipmentGroup(userId, order_nos, primary_order_no);
        res.status(200).json({ group });
    } catch (error) {
        console.error('Failed to create shipment group:', error.message);
        res.status(500).json({ error: 'Failed to create shipment group' });
    }
}

module.exports = {
    listShipmentGroups,
    createShipmentGroup,
    estimateRates: async (req, res) => {
        const groupId = req.params.id;
        const userId = Number(req.body?.user_id || req.query?.user_id || req.query?.userId);
        if (!groupId) {
            return res.status(400).json({ error: 'group id is required' });
        }
        if (!userId) {
            return res.status(400).json({ error: 'user_id is required' });
        }
        try {
            const rates = await shipmentGroupService.estimateRates(groupId, userId, req.body || {});
            res.status(200).json({ rates });
        } catch (error) {
            console.error('Failed to estimate rates:', error.message);
            res.status(500).json({ error: 'Failed to estimate rates' });
        }
    },
    createShipment: async (req, res) => {
        const groupId = req.params.id;
        const userId = Number(req.body?.user_id || req.query?.user_id || req.query?.userId);
        if (!groupId) {
            return res.status(400).json({ error: 'group id is required' });
        }
        if (!userId) {
            return res.status(400).json({ error: 'user_id is required' });
        }
        try {
            const result = await shipmentGroupService.createShipmentForGroup(groupId, userId, req.body || {});
            res.status(200).json(result);
        } catch (error) {
            console.error('Failed to create shipment for group:', error.message);
            res.status(500).json({ error: 'Failed to create shipment' });
        }
    },
};
