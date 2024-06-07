// src/services/itemService.js
const supabase = require('../supabaseClient');
const axios = require('axios');
require('dotenv').config();

async function fetchItemImages(legacyItemIds) {
    const { data, error } = await supabase
        .from('orders')
        .select('legacy_item_id, image_url')
        .in('legacy_item_id', legacyItemIds);

    if (error) {
        console.error('Error fetching item images from Supabase:', error.message);
        return {};
    }

    // legacyItemId をキーとして画像URLをマッピング
    const imageMap = {};
    data.forEach(item => {
        imageMap[item.legacy_item_id] = item.image_url;
    });

    return imageMap;
}

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

async function fetchItemImage(legacyItemId) {
  // Supabaseから既存の画像URLを取得
  const { data, error } = await supabase
      .from('items')
      .select('legacy_item_id, image_url')
      .eq('legacy_item_id', legacyItemId)
      .single();

  if (error) {
      // エラーが発生した場合、もしくは画像URLが存在しない場合はeBay APIを呼び出す
      const itemDetails = await fetchItemDetails(legacyItemId);
      console.log(itemDetails)
      const imageUrl = itemDetails.PictureURL;

      // Supabaseに画像URLを保存
      await supabase
          .from('items')
          .upsert({ legacy_item_id: legacyItemId, image_url: imageUrl }, { onConflict: 'legacy_item_id' });

      return imageUrl;
  }

  // 既存の画像URLを返す
  return data.image_url;
}

module.exports = {
  fetchItemImages,
  fetchItemImage,
  fetchItemDetails
};