const axios = require('axios');
const supabase = require('../supabaseClient');
const { getAccountById, refreshEbayToken } = require('./accountService');

const EBAY_MARKETING_API_BASE = 'https://api.ebay.com/sell/marketing/v1';

async function getSendOfferEligibleItems(accountId, { limit = 20, offset = 0 } = {}) {
    if (!accountId) {
        throw new Error('accountId is required');
    }

    const account = await getAccountById(accountId);
    if (!account) {
        throw new Error('Account not found');
    }
    if (!account.refresh_token) {
        throw new Error('Account does not have a refresh token');
    }

    const accessToken = await refreshEbayToken(account.refresh_token);
    const safeLimit = Math.min(Math.max(Number(limit) || 0, 1), 200);
    const safeOffset = Math.max(Number(offset) || 0, 0);
    const marketplaceId = account.marketplace_id || process.env.EBAY_MARKETPLACE_ID || 'EBAY_US';

    const url = 'https://api.ebay.com/sell/negotiation/v1/find_eligible_items';

    try {
        const { data } = await axios.get(url, {
            params: { limit: safeLimit, offset: safeOffset },
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'X-EBAY-C-MARKETPLACE-ID': marketplaceId,
                'Accept-Language': 'en-US'
            }
        });
        return data;
    } catch (err) {
        const status = err?.response?.status;
        const responseData = err?.response?.data;
        const message = responseData?.error || err.message || 'Failed to fetch eligible items';
        const error = new Error(message);
        error.status = status;
        error.responseData = responseData;
        throw error;
    }
}

const normalizeBidPercentage = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    const rounded = Math.round(numeric * 10) / 10;
    if (rounded < 2 || rounded > 100) return null;
    return rounded.toFixed(1);
};

const fetchActiveListingIds = async (userId, ebayUserId) => {
    const ids = [];
    const pageSize = 1000;
    let offset = 0;
    for (let page = 0; page < 200; page += 1) {
        const { data, error } = await supabase
            .from('items')
            .select('ebay_item_id')
            .eq('user_id', userId)
            .eq('ebay_user_id', ebayUserId)
            .eq('listing_status', 'ACTIVE')
            .order('ebay_item_id', { ascending: true })
            .range(offset, offset + pageSize - 1);
        if (error) {
            throw new Error(`Failed to fetch active listings: ${error.message}`);
        }
        const pageIds = (data || []).map((item) => item.ebay_item_id).filter(Boolean);
        ids.push(...pageIds);
        if (pageIds.length < pageSize) {
            break;
        }
        offset += pageSize;
    }
    return ids;
};

const createPromotedCampaign = async (accessToken, marketplaceId, campaignName, bidPercentage, endDate = null) => {
    const payload = {
        campaignName,
        startDate: new Date().toISOString(),
        fundingStrategy: {
            bidPercentage,
            fundingModel: 'COST_PER_SALE',
        },
        marketplaceId,
    };
    if (endDate) {
        payload.endDate = endDate;
    }
    const response = await axios.post(`${EBAY_MARKETING_API_BASE}/ad_campaign`, payload, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
    });
    const location = response?.headers?.location || '';
    const campaignId = location.split('/').pop() || null;
    if (!campaignId) {
        throw new Error('Campaign ID not found in response');
    }
    return campaignId;
};

const bulkCreateAdsByListingId = async (accessToken, campaignId, listingIds, bidPercentage) => {
    const payload = {
        requests: listingIds.map((listingId) => ({
            listingId: String(listingId),
            bidPercentage,
        })),
    };
    const response = await axios.post(
        `${EBAY_MARKETING_API_BASE}/ad_campaign/${campaignId}/bulk_create_ads_by_listing_id`,
        payload,
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        }
    );
    return response.data || {};
};

const normalizeEndDate = (value) => {
    if (!value) return null;
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return `${trimmed}T23:59:59.000Z`;
    }
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
};

async function bulkApplyPromotedListings({ accountIds = [], bidPercentage, endDate = null }) {
    if (!Array.isArray(accountIds) || accountIds.length === 0) {
        throw new Error('accountIds is required');
    }
    const normalizedBid = normalizeBidPercentage(bidPercentage);
    if (!normalizedBid) {
        throw new Error('bidPercentage must be between 2.0 and 100.0');
    }
    const normalizedEndDate = normalizeEndDate(endDate);
    if (endDate && !normalizedEndDate) {
        throw new Error('endDate must be a valid date (YYYY-MM-DD)');
    }

    const results = [];
    for (const accountId of accountIds) {
        try {
            const account = await getAccountById(accountId);
            if (!account) {
                throw new Error('Account not found');
            }
            if (!account.refresh_token) {
                throw new Error('Account does not have a refresh token');
            }
            const accessToken = await refreshEbayToken(account.refresh_token);
            const marketplaceId = account.marketplace_id || process.env.EBAY_MARKETPLACE_ID || 'EBAY_US';
            const campaignName = `Auto Promoted ${new Date().toISOString().slice(0, 10)} ${account.ebay_user_id || account.id}`;

            const listingIds = await fetchActiveListingIds(account.user_id, account.ebay_user_id);
            if (listingIds.length === 0) {
                results.push({
                    accountId,
                    ebay_user_id: account.ebay_user_id,
                    campaignId: null,
                    createdAds: 0,
                    message: 'No active listings found',
                });
                continue;
            }

            const campaignId = await createPromotedCampaign(
                accessToken,
                marketplaceId,
                campaignName,
                normalizedBid,
                normalizedEndDate
            );

            let createdAds = 0;
            for (let i = 0; i < listingIds.length; i += 500) {
                const chunk = listingIds.slice(i, i + 500);
                const bulkResponse = await bulkCreateAdsByListingId(accessToken, campaignId, chunk, normalizedBid);
                const successes = Array.isArray(bulkResponse?.responses)
                    ? bulkResponse.responses.filter((item) => item?.statusCode >= 200 && item?.statusCode < 300).length
                    : chunk.length;
                createdAds += successes;
            }

            results.push({
                accountId,
                ebay_user_id: account.ebay_user_id,
                campaignId,
                createdAds,
            });
        } catch (err) {
            results.push({
                accountId,
                error: err.message || 'Failed to apply promoted listings',
            });
        }
    }
    return { results };
}

module.exports = {
    getSendOfferEligibleItems,
    bulkApplyPromotedListings,
};
