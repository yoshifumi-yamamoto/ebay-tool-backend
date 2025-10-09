const supabase = require('../supabaseClient');
const axios = require('axios');
const xml2js = require('xml2js'); // xml2jsをインポート
require('dotenv').config();

const soldOutPatterns = ["売り切れ", "在庫なし", "売却済み", "sold out", "売れ切り", ""]; // 売り切れを表すパターン

const MAX_RETRIES = 3;
const CONCURRENCY_LIMIT = 2; // 並行リクエストの最大数
const RETRY_DELAY = 2000; // 2秒

function isSoldOut(stockStatus) {
    return soldOutPatterns.some(pattern => stockStatus.trim() === pattern);
}

function formatForEbayAPI(octoparseData, matchingItems) {
    return octoparseData.map((data) => {
        const quantity = isSoldOut(data["在庫"]) ? 0 : parseInt(data["在庫"], 10) || 1; // 数量が空の場合に1をデフォルト設定
        const itemId = matchingItems[data.URL] || matchingItems[data["店铺URL"]]; // URLをキーにして一致するitemIdを取得

        if (!itemId) {
            console.error(`No matching itemId found for URL: ${data.URL} or 店铺URL: ${data["店铺URL"]}`);
            return {
                itemId: "", // itemIdが見つからない場合は空文字
                quantity: quantity,
                url: data.URL || data["店铺URL"],
                stockStatus: data["在庫"],
                status: "error",
                errorCode: 999,
                shortMessage: "item does not match",
                longMessage: "No matching itemId found",
            };
        }

        return {
            itemId: itemId, // eBayのSKUを設定
            quantity: quantity,
            url: data.URL || data["店铺URL"],
            stockStatus: data["在庫"],
            itemStatus: "",
            errorCode: "",
        };
    });
}

const fetchMatchingItems = async (octoparseData, ebayUserId) => {
    const batchSize = 5; // 一度に処理するバッチのサイズを10に設定
    const matchingItems = {};
    console.log("fetchMatchingItems");

    for (let i = 0; i < octoparseData.length; i += batchSize) {
        const batch = octoparseData.slice(i, i + batchSize);
        const urls = batch.map(data => data.URL || data["店铺URL"]);

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
            items.forEach(item => { matchingItems[item.stocking_url] = item.ebay_item_id; });
        }
    }
    console.log("Matching items fetched:", matchingItems);
    return matchingItems;
};

const processDataAndFetchMatchingItems = async (octoparseData, ebayUserId) => {
    const matchingItems = await fetchMatchingItems(octoparseData, ebayUserId);
    const formattedData = formatForEbayAPI(octoparseData, matchingItems);
    console.log("Formatted data for eBay API:", formattedData);
    return formattedData;
};

async function fetchItemDetails(legacyItemId, authToken) {
    try {
        console.log(`🔹 開始: GetItem 呼び出し (ItemID: ${legacyItemId})`);

        const requestBody = `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
    <RequesterCredentials>
        <eBayAuthToken>${authToken}</eBayAuthToken>
    </RequesterCredentials>
    <ItemID>${legacyItemId}</ItemID>
    <IncludeSelector>Details,ItemSpecifics,ShippingCosts,PictureDetails</IncludeSelector>
</GetItemRequest>`;

        const response = await axios.post('https://api.ebay.com/ws/api.dll', requestBody, {
            headers: {
                'Content-Type': 'text/xml',
                'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
                'X-EBAY-API-DEV-NAME': process.env.EBAY_DEV_ID,
                'X-EBAY-API-APP-NAME': process.env.EBAY_APP_ID,
                'X-EBAY-API-CERT-NAME': process.env.EBAY_CERT_ID,
                'X-EBAY-API-CALL-NAME': 'GetItem',
                'X-EBAY-API-SITEID': '0',
            }
        });

        console.log(`✅ GetItem レスポンス受信 (HTTPステータス: ${response.status})`);
        if (response.status !== 200) {
            console.error(`❌ HTTP エラー: ステータス ${response.status}`);
            throw new Error(`HTTP error: ${response.status}`);
        }

        const parser = new xml2js.Parser({ explicitArray: false });
        const result = await parser.parseStringPromise(response.data);

        if (!result.GetItemResponse) {
            console.error('❌ eBay API エラー: GetItemResponse が存在しません');
            console.log('レスポンス全文:', response.data);
            throw new Error('GetItemResponse not found');
        }

        const item = result.GetItemResponse.Item;
        if (!item) {
            console.error('❌ eBay API エラー: Item が存在しません');
            console.log('レスポンス全文:', JSON.stringify(result.GetItemResponse, null, 2));
            throw new Error('Item not found in GetItemResponse');
        }

        console.log(`📌 Item タイトル: ${item.Title || 'タイトルなし'}`);
        console.log(`📌 画像URL:`, item.PictureDetails?.PictureURL || '画像情報なし');

        return item;

    } catch (error) {
        console.error(`❌ GetItem 実行中エラー: ${error.message}`);
        if (error.response) {
            console.log('エラー時レスポンスデータ:', error.response.data);
        }
        throw error;
    }
}




async function fetchActiveListings(authToken, pageNumber = 1, entriesPerPage = 100) {
    try {
        const requestBody = `<?xml version="1.0" encoding="utf-8"?>
        <GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
            <RequesterCredentials>
                <eBayAuthToken>${authToken}</eBayAuthToken>
            </RequesterCredentials>
            <ActiveList>
                <Sort>TimeLeft</Sort>
                <Pagination>
                    <EntriesPerPage>${entriesPerPage}</EntriesPerPage>
                    <PageNumber>${pageNumber}</PageNumber>
                </Pagination>
            </ActiveList>
            <DetailLevel>ReturnAll</DetailLevel>
        </GetMyeBaySellingRequest>`;

        const response = await axios.post('https://api.ebay.com/ws/api.dll', 
            requestBody, 
            {
                headers: {
                    'Content-Type': 'text/xml',
                    'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
                    'X-EBAY-API-DEV-NAME': process.env.EBAY_DEV_ID,
                    'X-EBAY-API-APP-NAME': process.env.EBAY_APP_ID,
                    'X-EBAY-API-CERT-NAME': process.env.EBAY_CERT_ID,
                    'X-EBAY-API-CALL-NAME': 'GetMyeBaySelling',
                    'X-EBAY-API-SITEID': '0',
                }
            }
        );

        const parser = new xml2js.Parser();
        const result = await parser.parseStringPromise(response.data);

        const activeList = result.GetMyeBaySellingResponse.ActiveList?.ItemArray?.Item;
        if (!activeList) {
            throw new Error('ActiveList not found in eBay API response');
        }
        const itemIds = Array.isArray(activeList) ? activeList.map(item => item.ItemID) : [activeList.ItemID];
        const totalEntries = parseInt(result.GetMyeBaySellingResponse.ActiveList.PaginationResult.TotalNumberOfEntries, 10);


        return { itemIds, totalEntries };
    } catch (error) {
        console.error('Error fetching active listings from eBay:', error.response ? error.response.data : error.message);
        throw new Error('Failed to fetch active listings from eBay');
    }
}




async function updateItemsTable(listings, userId, ebayUserId) {
    const retryFetch = async (fn, retries = MAX_RETRIES, delay = RETRY_DELAY) => {
        for (let i = 0; i < retries; i++) {
            try {
                return await fn();
            } catch (error) {
                console.error(`Retrying (${i + 1}/${retries}) due to error:`, error.message);
                if (i < retries - 1) await new Promise(resolve => setTimeout(resolve, delay));
                else throw error;
            }
        }
    };

    const syncedAt = new Date().toISOString(); // 同期した日時を取得

    for (const listing of listings) {
        const { legacyItemId, title, category_id, category_name, category_path } = listing;

        try {
            // itemsテーブル内の一致するデータを検索
            const existingItem = await retryFetch(async () => {
                const { data, error } = await supabase
                    .from('items')
                    .select('quantity')
                    .eq('ebay_item_id', legacyItemId)
                    .maybeSingle();
                if (error) throw error;
                return data;
            });

            if (existingItem) {
                // 一致するデータがあれば、数量と同期日を更新
                await retryFetch(async () => {
                    const { error } = await supabase
                        .from('items')
                        .update({ last_synced_at: syncedAt, category_id, category_name, category_path, title })
                        .eq('ebay_item_id', legacyItemId);
                    if (error) throw error;
                });
            } else {
                // 一致するデータがなければ、新たにデータを追加
                await retryFetch(async () => {
                    const { error } = await supabase
                        .from('items')
                        .insert({ ebay_item_id: legacyItemId, user_id: userId, title, ebay_user_id: ebayUserId, last_synced_at: syncedAt, category_id, category_name, category_path });
                    if (error) throw error;
                });
            }
        } catch (error) {
            console.error('Error updating item in Supabase:', error.message);
        }
    }
}


async function syncActiveListingsForUser(userId) {
    const { data: accounts, error: accountsError } = await supabase
        .from('accounts')
        .select('refresh_token, ebay_user_id')
        .eq('user_id', userId);

    if (accountsError) {
        console.error('Error fetching accounts from Supabase:', accountsError.message);
        throw new Error('Failed to fetch accounts from database');
    }

    if (accounts.length === 0) {
        throw new Error('No eBay accounts found for the given user ID');
    }

    let totalItems = 0;

    for (const account of accounts) {
        const refreshToken = account.refresh_token;
        const ebayUserId = account.ebay_user_id;
        console.log({ ebayUserId });

        try {
            const authToken = await refreshEbayToken(refreshToken);
            const firstPageData = await fetchActiveListings(authToken, 1, 100);
            const firstPageItemIds = firstPageData.itemIds;
            const totalEntries = firstPageData.totalEntries;
            totalItems += firstPageItemIds.length;

            let listings = [];
            for (const itemId of firstPageItemIds) {
                const itemDetails = await fetchItemDetails(itemId, authToken);
                if (itemDetails && itemDetails.PrimaryCategoryID) {
                    listings.push({
                        legacyItemId: itemId,
                        category_id: itemDetails.PrimaryCategoryID,
                        category_name: itemDetails.PrimaryCategoryName,
                        category_path: itemDetails.PrimaryCategoryIDPath,
                        title: itemDetails.Title,
                    });
                }
            }
            await updateItemsTable(listings, userId, ebayUserId);

            const totalPages = Math.ceil(totalEntries / 100);
            const maxPages = Math.min(totalPages, 100);

            for (let pageNumber = 2; pageNumber <= maxPages; pageNumber++) {
                try {
                    const pageData = await fetchActiveListings(authToken, pageNumber, 100);
                    const pageItemIds = pageData.itemIds;
                    totalItems += pageItemIds.length;

                    listings = [];
                    for (const itemId of pageItemIds) {
                        const itemDetails = await fetchItemDetails(itemId, authToken);
                        if (itemDetails && itemDetails.PrimaryCategoryID) {
                            listings.push({
                                legacyItemId: itemId,
                                category_id: itemDetails.PrimaryCategoryID,
                                category_name: itemDetails.PrimaryCategoryName,
                                category_path: itemDetails.PrimaryCategoryIDPath,
                                title: itemDetails.Title,
                            });
                        }
                    }
                    await updateItemsTable(listings, userId, ebayUserId);
                } catch (pageError) {
                    console.error(`Error fetching page ${pageNumber}:`, pageError.message);
                }
            }
        } catch (error) {
            console.error('Error during token refresh or fetching listings:', error.message);
        }
    }

    console.log(`Total items fetched: ${totalItems}`);
    return totalItems;
}




async function refreshEbayToken(refreshToken) {
    
    const queryString = require('query-string')
    const response = await axios.post('https://api.ebay.com/identity/v1/oauth2/token', queryString.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        scope: 'https://api.ebay.com/oauth/api_scope https://api.ebay.com/oauth/api_scope/sell.inventory.readonly https://api.ebay.com/oauth/api_scope/sell.inventory'
    }), {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${Buffer.from(`${process.env.EBAY_APP_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString('base64')}`
        }
    });

    if (response.status === 200) {
        return response.data.access_token;
    } else {
        console.error('Error refreshing eBay token:', response.data);
        throw new Error('Failed to refresh eBay token');
    }
}

module.exports = {
    fetchItemDetails,
    processDataAndFetchMatchingItems,
    fetchMatchingItems,
    formatForEbayAPI,
    updateItemsTable,
    syncActiveListingsForUser,
    fetchActiveListings,
    refreshEbayToken
};
