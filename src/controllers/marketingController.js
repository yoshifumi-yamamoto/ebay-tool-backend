const { getSendOfferEligibleItems } = require('../services/marketingService');

exports.getSendOfferEligible = async (req, res) => {
    const { accountId, limit, offset } = req.query;

    try {
        const data = await getSendOfferEligibleItems(accountId, { limit, offset });
        res.json(data);
    } catch (error) {
        console.error('Failed to fetch send offer eligible items:', error.message);
        res.status(500).json({ error: error.message || 'Failed to fetch eligible items' });
    }
};
