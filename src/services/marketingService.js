const axios = require('axios');
const { getAccountById, refreshEbayToken } = require('./accountService');

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

    const url = 'https://api.ebay.com/sell/negotiation/v1/find_eligible_items';

    const { data } = await axios.get(url, {
        params: { limit: safeLimit, offset: safeOffset },
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        }
    });

    return data;
}

module.exports = {
    getSendOfferEligibleItems
};
