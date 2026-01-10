const { syncActiveListingsForUser } = require('../services/itemService');

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
        res.status(500).json({ message: 'Failed to synchronize active listings' });
    }
};
