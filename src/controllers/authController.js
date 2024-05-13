const axios = require('axios');
// const queryString = require('query-string');
const accountService = require('../services/accountService');
require('dotenv').config();

exports.getEbayAuthUrl = (req, res) => {
    const clientId = process.env.EBAY_APP_ID;
    const redirectUri = process.env.EBAY_REDIRECT_URI;
    const scope = 'https://api.ebay.com/oauth/api_scope';
    const authorizationUrl = `https://auth.ebay.com/oauth2/authorize?client_id=${clientId}&response_type=code&redirect_uri=${redirectUri}&scope=${encodeURIComponent(scope)}`;
    res.json({ url: authorizationUrl });
};

// router.get('/ebay-auth-url', (req, res) => {
//   const clientId = process.env.EBAY_APP_ID;  // 環境変数から読み込み
//   const redirectUri = process.env.EBAY_REDIRECT_URI;  // エンコードせずに使用
//   const scope = 'https://api.ebay.com/oauth/api_scope https://api.ebay.com/oauth/api_scope/sell.marketing.readonly https://api.ebay.com/oauth/api_scope/sell.marketing https://api.ebay.com/oauth/api_scope/sell.inventory.readonly https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/sell.account.readonly https://api.ebay.com/oauth/api_scope/sell.account https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly https://api.ebay.com/oauth/api_scope/sell.fulfillment https://api.ebay.com/oauth/api_scope/sell.analytics.readonly https://api.ebay.com/oauth/api_scope/sell.finances https://api.ebay.com/oauth/api_scope/sell.payment.dispute https://api.ebay.com/oauth/api_scope/commerce.identity.readonly https://api.ebay.com/oauth/api_scope/sell.reputation https://api.ebay.com/oauth/api_scope/sell.reputation.readonly https://api.ebay.com/oauth/api_scope/commerce.notification.subscription https://api.ebay.com/oauth/api_scope/commerce.notification.subscription.readonly https://api.ebay.com/oauth/api_scope/sell.stores https://api.ebay.com/oauth/api_scope/sell.stores.readonly';
//   const authorizationUrl = `https://auth.ebay.com/oauth2/authorize?client_id=${clientId}&response_type=code&redirect_uri=${redirectUri}&scope=${encodeURIComponent(scope)}`;
//   res.json({ url: authorizationUrl });
// });


exports.getEbayToken = async (req, res) => {

  let queryString;
    try {
        queryString = (await import('query-string')).default;
    } catch (e) {
        console.error('Failed to import query-string:', e);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
  const code = req.body.code;
  const params = {
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: process.env.EBAY_REDIRECT_URI,
      client_id: process.env.EBAY_APP_ID,
      client_secret: process.env.EBAY_CLIENT_SECRET
  };

  try {
      const response = await axios.post('https://api.ebay.com/identity/v1/oauth2/token', queryString.stringify(params), {
          headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
          }
      });

      const { access_token, refresh_token, expires_in } = response.data;
      // トークンをaccountsテーブルに保存
      const saveResult = await accountService.saveAccountToken({
          user_id: req.user.id,  // ユーザー識別情報を適切に設定
          access_token,
          refresh_token,
          token_expiration: new Date(new Date().getTime() + expires_in * 1000)
      });

      if (saveResult.error) {
          throw new Error('Failed to save the tokens in the database.');
      }

      res.json({ access_token, refresh_token, expires_in });
  } catch (error) {
      console.error('Error fetching eBay tokens:', error);
      res.status(500).json({ error: 'Failed to fetch eBay tokens', details: error.message });
  }
};
