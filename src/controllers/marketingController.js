const { getSendOfferEligibleItems, bulkApplyPromotedListings } = require('../services/marketingService');

exports.getSendOfferEligible = async (req, res) => {
    const { accountId, limit, offset } = req.query;

    try {
        console.info('[marketing] getSendOfferEligible start', {
            accountId,
            limit,
            offset
        });
        const data = await getSendOfferEligibleItems(accountId, { limit, offset });
        res.json(data);
    } catch (error) {
        const responseErrors = Array.isArray(error?.responseData?.errors)
            ? error.responseData.errors
            : null;
        console.error('[marketing] Failed to fetch send offer eligible items:', {
            message: error.message,
            status: error.status,
            code: error.code,
            responseData: error.responseData,
            responseErrors
        });
        res.status(error.status || 500).json({
            error: error.message || 'Failed to fetch eligible items',
            details: responseErrors || error.responseData || null
        });
    }
};

exports.bulkApplyPromotedListings = async (req, res) => {
    const { accountIds, bidPercentage, endDate } = req.body || {};
    try {
        const data = await bulkApplyPromotedListings({ accountIds, bidPercentage, endDate });
        res.json(data);
    } catch (error) {
        res.status(400).json({ error: error.message || 'Failed to apply promoted listings' });
    }
};
