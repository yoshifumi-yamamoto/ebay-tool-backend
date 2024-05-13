// const express = require('express');
// const axios = require('axios');
// const querystring = require('querystring');
// require('dotenv').config();

// const router = express.Router();

// router.get('/ebay-auth-url', (req, res) => {
//   const clientId = process.env.EBAY_APP_ID;  // 環境変数から読み込み
//   const redirectUri = process.env.EBAY_REDIRECT_URI;  // エンコードせずに使用
//   const scope = 'https://api.ebay.com/oauth/api_scope https://api.ebay.com/oauth/api_scope/sell.marketing.readonly https://api.ebay.com/oauth/api_scope/sell.marketing https://api.ebay.com/oauth/api_scope/sell.inventory.readonly https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/sell.account.readonly https://api.ebay.com/oauth/api_scope/sell.account https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly https://api.ebay.com/oauth/api_scope/sell.fulfillment https://api.ebay.com/oauth/api_scope/sell.analytics.readonly https://api.ebay.com/oauth/api_scope/sell.finances https://api.ebay.com/oauth/api_scope/sell.payment.dispute https://api.ebay.com/oauth/api_scope/commerce.identity.readonly https://api.ebay.com/oauth/api_scope/sell.reputation https://api.ebay.com/oauth/api_scope/sell.reputation.readonly https://api.ebay.com/oauth/api_scope/commerce.notification.subscription https://api.ebay.com/oauth/api_scope/commerce.notification.subscription.readonly https://api.ebay.com/oauth/api_scope/sell.stores https://api.ebay.com/oauth/api_scope/sell.stores.readonly';
//   const authorizationUrl = `https://auth.ebay.com/oauth2/authorize?client_id=${clientId}&response_type=code&redirect_uri=${redirectUri}&scope=${encodeURIComponent(scope)}`;
//   res.json({ url: authorizationUrl });
// });




// router.get('/callback', async (req, res) => {
//   const { code } = req.query;
//   if (!code) {
//     return res.status(400).send('Authorization code is missing.');
//   }

//   try {
//     const tokenData = await exchangeCodeForToken(code);
//     res.json(tokenData);
//   } catch (error) {
//     console.error('Token exchange failed:', error);
//     res.status(500).json({ error: 'Failed to retrieve token', details: error.message });
//   }
// });


// async function exchangeCodeForToken(code) {
//   const tokenUrl = 'https://api.ebay.com/identity/v1/oauth2/token';
//   const credentials = `${process.env.EBAY_APP_ID}:${process.env.EBAY_CERT_ID}`;
//   const encodedCredentials = Buffer.from(credentials).toString('base64');

//   const response = await axios.post(tokenUrl, querystring.stringify({
//     grant_type: 'authorization_code',
//     code: code,
//     redirect_uri: process.env.EBAY_REDIRECT_URI,
//   }), {
//     headers: {
//       'Content-Type': 'application/x-www-form-urlencoded',
//       'Authorization': `Basic ${encodedCredentials}`
//     }
//   });
//   return response.data;
// }

// module.exports = router;

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// eBay認証URLを取得するエンドポイント
router.get('/ebay-auth-url', authController.getEbayAuthUrl);

// eBayからの認証コードを受け取り、トークンを取得するエンドポイント
router.post('/ebay-token', authController.getEbayToken);

module.exports = router;
