const {
    getSendOfferEligibleItems,
    sendOfferToInterestedBuyers,
    getMarkdownCategoryCandidates,
    listMarkdownPresets,
    createMarkdownPreset,
    updateMarkdownPreset,
    deleteMarkdownPreset,
    previewMarkdownPresets,
    executeMarkdownPresets,
    createMarkdownSaleEvent,
    bulkApplyPromotedListings
} = require('../services/marketingService');

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

exports.sendOfferToInterestedBuyers = async (req, res) => {
    const { accountId, discountType, discountValue, message, minPrice, maxPrice, listingIds } = req.body || {};
    try {
        const data = await sendOfferToInterestedBuyers({
            accountId,
            discountType,
            discountValue,
            message,
            minPrice,
            maxPrice,
            listingIds,
        });
        res.json(data);
    } catch (error) {
        res.status(error.status || 400).json({
            error: error.message || 'Failed to send offer',
            details: error.responseData || null,
        });
    }
};

exports.getMarkdownCategories = async (req, res) => {
    const { accountId, limit } = req.query;
    try {
        const data = await getMarkdownCategoryCandidates(accountId, { limit });
        res.json({ categories: data });
    } catch (error) {
        res.status(400).json({ error: error.message || 'Failed to fetch markdown categories' });
    }
};

exports.listMarkdownPresets = async (req, res) => {
    const { accountId } = req.query;
    try {
        const data = await listMarkdownPresets(accountId);
        res.json({ presets: data });
    } catch (error) {
        res.status(400).json({ error: error.message || 'Failed to fetch markdown presets' });
    }
};

exports.createMarkdownPreset = async (req, res) => {
    try {
        const data = await createMarkdownPreset(req.body || {});
        res.status(201).json(data);
    } catch (error) {
        res.status(400).json({ error: error.message || 'Failed to create markdown preset' });
    }
};

exports.updateMarkdownPreset = async (req, res) => {
    try {
        const data = await updateMarkdownPreset(req.params.id, req.body || {});
        res.json(data);
    } catch (error) {
        res.status(400).json({ error: error.message || 'Failed to update markdown preset' });
    }
};

exports.deleteMarkdownPreset = async (req, res) => {
    try {
        const data = await deleteMarkdownPreset(req.params.id);
        res.json(data);
    } catch (error) {
        res.status(400).json({ error: error.message || 'Failed to delete markdown preset' });
    }
};

exports.previewMarkdownPresets = async (req, res) => {
    try {
        const data = await previewMarkdownPresets(req.body || {});
        res.json(data);
    } catch (error) {
        res.status(400).json({ error: error.message || 'Failed to preview markdown presets' });
    }
};

exports.executeMarkdownPresets = async (req, res) => {
    try {
        const data = await executeMarkdownPresets(req.body || {});
        res.json(data);
    } catch (error) {
        res.status(400).json({ error: error.message || 'Failed to execute markdown presets' });
    }
};

exports.createMarkdownSaleEvent = async (req, res) => {
    const {
        accountId,
        discountPercent,
        startDate,
        endDate,
        categoryIds,
        minPrice,
        maxPrice,
        name,
        description,
    } = req.body || {};
    try {
        const data = await createMarkdownSaleEvent({
            accountId,
            discountPercent,
            startDate,
            endDate,
            categoryIds,
            minPrice,
            maxPrice,
            name,
            description,
        });
        res.json(data);
    } catch (error) {
        res.status(error.status || 400).json({
            error: error.message || 'Failed to create markdown sale event',
            details: error.responseData || null,
        });
    }
};
