const express = require('express');
const axios = require('axios');
const querystring = require('querystring');
require('dotenv').config();

const router = express.Router();

router.get('/auth', (req, res) => {
  const authorizationUrl = `https://auth.ebay.com/oauth2/authorize?client_id=${process.env.EBAY_APP_ID}&redirect_uri=${encodeURIComponent(process.env.EBAY_REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent('https://api.ebay.com/oauth/api_scope')}`;
  res.redirect(authorizationUrl);
});

router.get('/callback', async (req, res) => {
  const { code } = req.query;
  const tokenUrl = 'https://api.ebay.com/identity/v1/oauth2/token';

  try {
    const response = await axios.post(tokenUrl, querystring.stringify({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: process.env.EBAY_REDIRECT_URI,
    }), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${process.env.EBAY_APP_ID}:${process.env.EBAY_CERT_ID}`).toString('base64')}`
      }
    });

    const { access_token, refresh_token } = response.data;
    res.json({ access_token, refresh_token });
  } catch (error) {
    console.error('Failed to retrieve access token:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;