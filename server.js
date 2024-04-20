const express = require('express');
require('dotenv').config();
const axios = require('axios');
const app = express();
const supabase = require('./supabaseClient');

const cors = require('cors');
app.use(cors());

const CLIENT_ID = process.env.EBAY_APP_ID;
const CLIENT_SECRET = process.env.EBAY_CERT_ID;

let accessToken = null;
let tokenExpires = null;

// トークンを取得する関数
async function getAccessToken() {
  if (accessToken && new Date() < tokenExpires) {
    return accessToken;  // 既存のトークンが有効な場合はそれを返す
  }

  const response = await axios({
    method: 'post',
    url: 'https://api.ebay.com/identity/v1/oauth2/token',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`
    },
    data: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope'
  });
  accessToken = response.data.access_token;
  tokenExpires = new Date(new Date().getTime() + response.data.expires_in * 1000);
  return accessToken;
}

// eBay APIリクエスト関数
const ebayApiRequest = async () => {
  try {
    const token = await getAccessToken();
    const { data } = await axios({
      method: 'get',
      url: 'https://api.ebay.com/sell/stores/v1/store',
      headers: {
        'X-EBAY-API-SITEID': '0',
        // 'X-EBAY-API-CALL-NAME': 'GetOrders',
        'X-EBAY-API-APP-NAME': process.env.EBAY_APP_ID,
        'X-EBAY-API-DEV-NAME': process.env.EBAY_DEV_ID,
        'X-EBAY-API-CERT-NAME': process.env.EBAY_CERT_ID,
        'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
        'Content-Type': 'application/json',
        // 'Authorization': `Bearer ${token}`
        'Authorization': `Bearer ${process.env.EBAY_USER_TOKEN}`
      }});

    return data;
  } catch (error) {
    // エラーハンドリングをここに実装
    console.error("Error during eBay API Request:", error);
    throw error; // またはエラーに基づいて適切なレスポンスを返します
  }
};

const PORT = process.env.PORT || 5001;

// ルート定義: eBayの注文データを取得
app.get('/ebay-orders', async (req, res) => {
  try {
    const data = await ebayApiRequest();
    res.json(data);
  } catch (error) {
    console.error(error); // コンソールにエラーの詳細を出力する
    res.status(500).json({
      message: 'Error fetching eBay orders.',
      error: error.message // レスポンスにエラーメッセージを含める
    });
  }
});

async function getUsers() {
  const { data, error } = await supabase
    .from('users')
    .select('*')

  if (error) {
    console.error('Error fetching users:', error)
    return { error }
  }

  return { data }
}

app.get('/users', async (req, res) => {
  const { data, error } = await getUsers() 
  if (error) {
    console.error('Error fetching users:', error);
    return res.status(500).json({ error: error.message });
  }
  if (data.length === 0) {
    return res.status(404).json({ message: 'No users found' });
  }
  res.json(data);
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});