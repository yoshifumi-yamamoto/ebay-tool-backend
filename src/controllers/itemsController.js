const { syncActiveListingsForUser } = require('../services/itemService');
const { logSystemError } = require('../services/systemErrorService');

exports.syncActiveListings = async (req, res) => {
    const userId = req.body.user_id;

    if (!userId) {
        return res.status(400).json({ message: 'User ID is required' });
    }

    try {
        console.info('[itemsController] syncActiveListings start', { userId });
        const totalItems = await syncActiveListingsForUser(userId);
        console.info('[itemsController] syncActiveListings complete', { userId, totalItems });
        res.status(200).json({ message: 'Active listings synchronized successfully', totalItems });
    } catch (error) {
        console.error('Error synchronizing active listings:', error.message);
        await logSystemError({
            error_code: 'ITEMS_SYNC_FAILED',
            category: 'ITEM_SYNC',
            severity: 'error',
            provider: 'ebay',
            message: 'Error synchronizing active listings',
            user_id: userId,
            details: { message: error.message },
        });
        res.status(500).json({ message: 'Failed to synchronize active listings' });
    }
};
