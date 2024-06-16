// src/services/itemService.js
const axios = require('axios');
require('dotenv').config();

// ebayから商品画像を取得
async function fetchItemDetails(legacyItemId, authToken) {
  try {
      const response = await axios.get(`https://open.api.ebay.com/shopping`, {
          headers: {
              'X-EBAY-API-IAF-TOKEN': authToken // ここにあなたの認証トークンを指定してください
          },
          params: {
              callname: 'GetSingleItem',
              responseencoding: 'JSON',
              appid: process.env.EBAY_APP_ID, // ここにあなたのアプリIDを入力してください
              siteid: '0',
              version: '967',
              ItemID: legacyItemId,
              IncludeSelector: 'Details'
          }
      });

      if (response.data.Item) {
          return response.data.Item;
      } else {
          console.log("legacyItemId",legacyItemId)
          console.error('Item not found in eBay response:', response.data);
          return null;
      }
  } catch (error) {
      console.error('Error fetching item details from eBay:', error.response ? error.response.data : error.message);
      throw new Error('Failed to fetch item details from eBay');
  }
}


module.exports = {
  fetchItemDetails
};