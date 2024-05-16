const supabase = require('../supabaseClient');
const axios = require('axios');

exports.createAccount = async (accountData) => {
  const { data, error } = await supabase
    .from('accounts')
    .insert([accountData]);
  if (error) throw new Error('Failed to create account: ' + error.message);
  return data;
};

// トークンの保存
exports.saveAccountToken = async ({ user_id, access_token, refresh_token, token_expiration }) => {
  const { data, error } = await supabase
    .from('accounts')
    .insert([
        { 
            user_id, 
            access_token, 
            refresh_token, 
            token_expiration 
        }
    ], { returning: "minimal" });  // returning: "minimal" は不要なレスポンスデータを減らすための設定

  if (error) {
      console.error('Error saving tokens:', error.message);
      throw new Error('Failed to save tokens to database: ' + error.message);
  }
  return data;
};



exports.getAccountsByUserId = async (userId) => {
    const { data, error } = await supabase
        .from('accounts')
        .select('*')
        .eq('user_id', userId);
    if (error) throw new Error('Failed to retrieve accounts: ' + error.message);
    return data;
};

exports.updateAccount = async (id, accountData) => {
    const { data, error } = await supabase
        .from('accounts')
        .update(accountData)
        .eq('id', id);
    if (error) throw new Error('Failed to update account: ' + error.message);
    return data;
};

exports.deleteAccount = async (id) => {
    const { data, error } = await supabase
        .from('accounts')
        .delete()
        .eq('id', id);
    if (error) throw new Error('Failed to delete account: ' + error.message);
    return data;
};

exports.fetchEbayAccountTokens = async (userId) => {
    const { data, error } = await supabase
        .from('accounts')
        .select('refresh_token')
        .eq('user_id', userId);

    if (error) {
        console.error('Failed to fetch eBay account tokens:', error.message);
        throw error;
    }
    return data.map(account => account.refresh_token);
}

exports.refreshEbayToken = async (refreshToken) => {
    let queryString;
    try {
        queryString = (await import('query-string')).default;
    } catch (e) {
        console.error('Failed to import query-string:', e);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
    const response = await axios.post('https://api.ebay.com/identity/v1/oauth2/token', queryString.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        scope: 'https://api.ebay.com/oauth/api_scope https://api.ebay.com/oauth/api_scope/sell.marketing.readonly https://api.ebay.com/oauth/api_scope/sell.marketing https://api.ebay.com/oauth/api_scope/sell.inventory.readonly https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/sell.account.readonly https://api.ebay.com/oauth/api_scope/sell.account https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly https://api.ebay.com/oauth/api_scope/sell.fulfillment https://api.ebay.com/oauth/api_scope/sell.analytics.readonly https://api.ebay.com/oauth/api_scope/sell.finances https://api.ebay.com/oauth/api_scope/sell.payment.dispute https://api.ebay.com/oauth/api_scope/commerce.identity.readonly https://api.ebay.com/oauth/api_scope/sell.reputation https://api.ebay.com/oauth/api_scope/sell.reputation.readonly https://api.ebay.com/oauth/api_scope/commerce.notification.subscription https://api.ebay.com/oauth/api_scope/commerce.notification.subscription.readonly https://api.ebay.com/oauth/api_scope/sell.stores https://api.ebay.com/oauth/api_scope/sell.stores.readonly' // 必要に応じてスコープを調整
    }), {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${Buffer.from(`${process.env.EBAY_APP_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString('base64')}`
        }
    });
    console.log("response.status",response.status)
    if (response.status === 200) {
        return response.data.access_token;
    } else {
        throw new Error('Failed to refresh eBay token');
    }
}