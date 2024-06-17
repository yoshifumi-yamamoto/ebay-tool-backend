const supabase = require('../supabaseClient');
const axios = require('axios');
require('dotenv').config();

const soldOutPatterns = ["売り切れ", "在庫なし", "売却済み", "sold out", "売れ切り", ""]; // 売り切れを表すパターン

function isSoldOut(stockStatus) {
    return soldOutPatterns.some(pattern => stockStatus.trim() === pattern);
}

function formatForEbayAPI(octoparseData, matchingItems) {
    return octoparseData.map((data) => {
        const quantity = isSoldOut(data["在庫"]) ? 0 : parseInt(data["在庫"], 10) || 1; // 数量が空の場合に1をデフォルト設定
        const itemId = matchingItems[data.URL]; // URLをキーにして一致するitemIdを取得
        return {
            itemId: itemId, // eBayのSKUを設定
            quantity: quantity,
            url: data.URL
        };
    });
}

const fetchMatchingItems = async (octoparseData, ebayUserId) => {
    const batchSize = 100; // 一度に処理するバッチのサイズ
    const matchingItems = {};
    console.log("fetchMatchingItems")

    for (let i = 0; i < octoparseData.length; i += batchSize) {
        const batch = octoparseData.slice(i, i + batchSize);
        const urls = batch.map(data => data.URL);

        const { data: items, error } = await supabase
            .from('items')
            .select('ebay_item_id, stocking_url')
            .in('stocking_url', urls)
            .eq('ebay_user_id', ebayUserId);

        if (error) {
            console.error('Error fetching data from Supabase:', error);
            continue;
        }

        if (items.length > 0) {
            items.forEach(item => {
                matchingItems[item.stocking_url] = item.ebay_item_id;
            });
        }
    }
    return matchingItems;
};

const processDataAndFetchMatchingItems = async (octoparseData, ebayUserId) => {
    const matchingItems = await fetchMatchingItems(octoparseData, ebayUserId);
    const formattedData = formatForEbayAPI(octoparseData, matchingItems);
    return formattedData;
};

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
  fetchItemDetails,
  processDataAndFetchMatchingItems
};
