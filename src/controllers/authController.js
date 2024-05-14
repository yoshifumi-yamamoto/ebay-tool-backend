const axios = require('axios');
// const queryString = require('query-string');
const accountService = require('../services/accountService');
require('dotenv').config();

exports.getEbayAuthUrl = (req, res) => {
    const clientId = process.env.EBAY_APP_ID;
    const redirectUri = process.env.EBAY_REDIRECT_URI;
    const scope = 'https://api.ebay.com/oauth/api_scope https://api.ebay.com/oauth/api_scope/sell.marketing.readonly https://api.ebay.com/oauth/api_scope/sell.marketing https://api.ebay.com/oauth/api_scope/sell.inventory.readonly https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/sell.account.readonly https://api.ebay.com/oauth/api_scope/sell.account https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly https://api.ebay.com/oauth/api_scope/sell.fulfillment https://api.ebay.com/oauth/api_scope/sell.analytics.readonly https://api.ebay.com/oauth/api_scope/sell.finances https://api.ebay.com/oauth/api_scope/sell.payment.dispute https://api.ebay.com/oauth/api_scope/commerce.identity.readonly https://api.ebay.com/oauth/api_scope/sell.reputation https://api.ebay.com/oauth/api_scope/sell.reputation.readonly https://api.ebay.com/oauth/api_scope/commerce.notification.subscription https://api.ebay.com/oauth/api_scope/commerce.notification.subscription.readonly https://api.ebay.com/oauth/api_scope/sell.stores https://api.ebay.com/oauth/api_scope/sell.stores.readonly';
    const authorizationUrl = `https://auth.ebay.com/oauth2/authorize?client_id=${clientId}&response_type=code&redirect_uri=${redirectUri}&scope=${encodeURIComponent(scope)}`;
    res.json({ url: authorizationUrl });
};

exports.getEbayToken = async (req, res) => {
  let queryString;
  try {
      queryString = (await import('query-string')).default;
  } catch (e) {
      console.error('Failed to import query-string:', e);
      return res.status(500).json({ error: 'Internal Server Error' });
  }

  const { code, user } = req.body;

  const credentials = Buffer.from(`${process.env.EBAY_APP_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString('base64');
  const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`
  };

  const params = queryString.stringify({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: process.env.EBAY_REDIRECT_URI
  });

  try {
      const response = await axios.post('https://api.ebay.com/identity/v1/oauth2/token', params, { headers });
      const { access_token, refresh_token, expires_in } = response.data;

      // saveAccountToken関数が正しいと仮定
      await accountService.saveAccountToken({
          user_id: user.id, // ユーザーIDが正しいことを確認
          access_token,
          refresh_token,
          token_expiration: new Date(new Date().getTime() + expires_in * 1000)
      });

      res.json({ access_token, refresh_token, expires_in });
  } catch (error) {
      console.error('eBayトークンの取得エラー:', error);
      res.status(500).json({ error: 'eBayトークンの取得に失敗しました', details: error.response?.data || error.message });
  }
};

exports.handleEbayCallback = async (req, res) => {
  const { code } = req.query;  // eBayから送られてくる認証コード
  if (!code) {
    return res.status(400).send('Authorization code is missing.');
  }

  try {
    const response = await axios.post('https://api.ebay.com/identity/v1/oauth2/token', queryString.stringify({
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: process.env.EBAY_REDIRECT_URI,
      client_id: process.env.EBAY_APP_ID,
      client_secret: process.env.EBAY_CERT_ID
    }), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    // ここでトークンをデータベースに保存する処理を入れます
    // 例: saveToken(response.data.access_token);

    // 認証が成功した後、ユーザーをフロントエンドの適切なページにリダイレクト
    res.redirect('/settings');
  } catch (error) {
    console.error('Error fetching eBay tokens:', error);
    res.status(500).send('Failed to fetch eBay tokens.');
  }
};