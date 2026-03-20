const supabase = require('../supabaseClient');
const { logSystemError } = require('./systemErrorService');
const axios = require('axios');
const xml2js = require('xml2js'); // xml2jsをインポート
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const soldOutPatterns = ["売り切れ", "在庫なし", "売却済み", "sold out", "売れ切り", ""]; // 売り切れを表すパターン

const MAX_RETRIES = 3;
const CONCURRENCY_LIMIT = 2; // 並行リクエストの最大数
const RETRY_DELAY = 2000; // 2秒

const syncLogPath = path.resolve(__dirname, '..', '..', '..', 'logs', 'active_listings_sync.log');

const logSyncEvent = (level, message, data = {}) => {
    try {
        const dir = path.dirname(syncLogPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        const payload = {
            ts: new Date().toISOString(),
            level,
            message,
            ...data,
        };
        fs.appendFileSync(syncLogPath, `${JSON.stringify(payload)}\n`, 'utf8');
    } catch (error) {
        console.error('Failed to write sync log:', error.message);
    }
};

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

    try {
        const requestBody = `<?xml version="1.0" encoding="utf-8"?>
        <GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
            <RequesterCredentials>
                <eBayAuthToken>${authToken}</eBayAuthToken>
            </RequesterCredentials>
            <ActiveList>
                <Include>true</Include>
                <Pagination>
                    <EntriesPerPage>${entriesPerPage}</EntriesPerPage>
                    <PageNumber>${pageNumber}</PageNumber>
                </Pagination>
            </ActiveList>
            <DetailLevel>ReturnAll</DetailLevel>
        </GetMyeBaySellingRequest>`;

        const response = await retryFetch(() => axios.post('https://api.ebay.com/ws/api.dll',
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
        ));

        const parser = new xml2js.Parser({ explicitArray: false });
        const result = await parser.parseStringPromise(response.data);

        const responseBody = result.GetMyeBaySellingResponse || {};
        const ack = responseBody.Ack || null;
        const errors = responseBody.Errors || null;
        const activeList = responseBody.ActiveList || {};
        const paginationRoot = activeList.PaginationResult || {};
        const totalEntries = parseInt(paginationRoot.TotalNumberOfEntries, 10) || 0;
        const returnedCount = parseInt(activeList.ReturnedItemCountActual, 10) || 0;
        const hasMoreItems = String(activeList.HasMoreItems ?? '').toLowerCase() === 'true';
        const rawItems = activeList.ItemArray?.Item;
        if (!rawItems) {
            if (returnedCount === 0) {
                logSyncEvent('info', 'GetMyeBaySelling empty result', {
                    ack,
                    errors,
                    pageNumber,
                    entriesPerPage,
                    totalEntries,
                });
                return { listings: [], totalEntries, hasMoreItems };
            }
            console.error('GetMyeBaySelling missing ItemArray', {
                ack,
                errors,
            });
            logSyncEvent('error', 'GetMyeBaySelling missing ItemArray', {
                ack,
                errors,
                pageNumber,
                entriesPerPage,
            });
            await logSystemError({
                error_code: 'EBAY_SELLER_LIST_MISSING',
                category: 'LISTINGS_SYNC',
                provider: 'ebay',
                message: 'GetMyeBaySelling missing ItemArray',
                payload_summary: { pageNumber, entriesPerPage },
                details: { ack, errors },
            });
            throw new Error('ItemArray not found in eBay API response');
        }
        const items = Array.isArray(rawItems) ? rawItems : [rawItems];
        const getTextValue = (value) => {
            if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, '_')) {
                return value._;
            }
            return value ?? null;
        };
        const listings = items.map((item) => {
            const currentPrice = item.StartPrice || item.SellingStatus?.CurrentPrice;
            const primaryImage = Array.isArray(item.PictureDetails?.PictureURL)
                ? item.PictureDetails.PictureURL[0]
                : item.PictureDetails?.PictureURL;
            return {
                legacyItemId: getTextValue(item.ItemID),
                sku: getTextValue(item?.SKU),
                // GetMyeBaySelling.ActiveList only returns active listings and does not include ListingStatus.
                status: 'ACTIVE',
                category_id: getTextValue(item?.PrimaryCategory?.CategoryID),
                category_name: getTextValue(item?.PrimaryCategory?.CategoryName),
                category_path: null,
                item_title: getTextValue(item?.Title),
                current_price_value: getTextValue(currentPrice),
                current_price_currency: currentPrice?.$?.currencyID || null,
                primary_image_url: primaryImage || null,
                view_item_url: getTextValue(item?.ListingDetails?.ViewItemURL) || getTextValue(item?.ListingDetails?.ViewItemURLForNaturalSearch),
            };
        });

        return { listings, totalEntries, hasMoreItems };
    } catch (error) {
        console.error('Error fetching active listings from eBay:', error.response ? error.response.data : error.message);
        logSyncEvent('error', 'Error fetching active listings', {
            pageNumber,
            entriesPerPage,
            error: error.response ? error.response.data : error.message,
        });
        await logSystemError({
            error_code: 'EBAY_ACTIVE_LIST_FETCH_FAILED',
            category: 'LISTINGS_SYNC',
            provider: 'ebay',
            message: 'Error fetching active listings from eBay',
            payload_summary: { pageNumber, entriesPerPage },
            details: error.response ? error.response.data : error.message,
        });
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

    let updatedCount = 0;
    let insertedCount = 0;
    let failedCount = 0;

    for (const listing of listings) {
        const {
            legacyItemId,
            sku,
            status,
            item_title,
            category_id,
            category_name,
            category_path,
            current_price_value,
            current_price_currency,
            primary_image_url,
            view_item_url
        } = listing;

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
                        .update({
                            last_synced_at: syncedAt,
                            listing_status: status,
                            status_synced_at: syncedAt,
                            category_id,
                            category_name,
                            category_path,
                            item_title,
                            sku,
                            current_price_value,
                            current_price_currency,
                            primary_image_url,
                            view_item_url
                        })
                        .eq('ebay_item_id', legacyItemId);
                    if (error) throw error;
                });
                updatedCount += 1;
            } else {
                // 一致するデータがなければ、新たにデータを追加
                await retryFetch(async () => {
                    const { error } = await supabase
                        .from('items')
                        .insert({
                            ebay_item_id: legacyItemId,
                            user_id: userId,
                            item_title,
                            sku,
                            ebay_user_id: ebayUserId,
                            last_synced_at: syncedAt,
                            listing_status: status,
                            status_synced_at: syncedAt,
                            category_id,
                            category_name,
                            category_path,
                            current_price_value,
                            current_price_currency,
                            primary_image_url,
                            view_item_url
                        });
                    if (error) throw error;
                });
                insertedCount += 1;
            }
        } catch (error) {
            console.error('Error updating item in Supabase:', error.message);
            await logSystemError({
                error_code: 'ITEM_SYNC_UPDATE_FAILED',
                category: 'ITEM_SYNC',
                provider: 'supabase',
                message: 'Error updating item in Supabase',
                user_id: userId,
                payload_summary: { ebayUserId, legacyItemId },
                details: error.message,
            });
            logSyncEvent('error', 'updateItemsTable item failed', {
                userId,
                ebayUserId,
                legacyItemId,
                error: error.message,
            });
            failedCount += 1;
        }
    }

    console.info('[itemService] updateItemsTable summary', {
        userId,
        ebayUserId,
        total: listings.length,
        updated: updatedCount,
        inserted: insertedCount,
        failed: failedCount,
    });
    logSyncEvent('info', 'updateItemsTable summary', {
        userId,
        ebayUserId,
        total: listings.length,
        updated: updatedCount,
        inserted: insertedCount,
        failed: failedCount,
    });

    return { updatedCount, insertedCount, failedCount };
}


async function syncActiveListingsForUser(userId) {
    const { data: accounts, error: accountsError } = await supabase
        .from('accounts')
        .select('refresh_token, ebay_user_id')
        .eq('user_id', userId);

    if (accountsError) {
        console.error('Error fetching accounts from Supabase:', accountsError.message);
        await logSystemError({
            error_code: 'ACCOUNT_FETCH_FAILED',
            category: 'LISTINGS_SYNC',
            provider: 'supabase',
            message: 'Error fetching accounts from Supabase',
            user_id: userId,
            details: accountsError.message,
        });
        throw new Error('Failed to fetch accounts from database');
    }

    if (accounts.length === 0) {
        throw new Error('No eBay accounts found for the given user ID');
    }

    let totalItems = 0;
    logSyncEvent('info', 'syncActiveListings start', {
        userId,
        accountCount: accounts.length,
    });

    for (const account of accounts) {
        const refreshToken = account.refresh_token;
        const ebayUserId = account.ebay_user_id;
        console.log({ ebayUserId });
        const statusCounts = {};
        logSyncEvent('info', 'account sync start', { userId, ebayUserId });

        try {
            const authToken = await refreshEbayToken(refreshToken);
            const firstPageData = await fetchActiveListings(authToken, 1, 100);
            const totalEntries = firstPageData.totalEntries;
            totalItems += firstPageData.listings.length;
            (firstPageData.listings || []).forEach((listing) => {
                const status = listing?.status || 'UNKNOWN';
                statusCounts[status] = (statusCounts[status] || 0) + 1;
            });
            console.info('[itemService] listings page fetched', {
                ebayUserId,
                page: 1,
                pageCount: firstPageData.listings.length,
                statusCounts,
                totalEntries,
            });
            logSyncEvent('info', 'listings page fetched', {
                ebayUserId,
                page: 1,
                pageCount: firstPageData.listings.length,
                statusCounts,
                totalEntries,
            });
            const firstPageSync = await updateItemsTable(firstPageData.listings, userId, ebayUserId);
            logSyncEvent('info', 'listings page synced', {
                ebayUserId,
                page: 1,
                pageCount: firstPageData.listings.length,
                updated: firstPageSync.updatedCount,
                inserted: firstPageSync.insertedCount,
                failed: firstPageSync.failedCount,
            });

            const totalPages = totalEntries ? Math.ceil(totalEntries / 100) : 0;
            const maxPages = totalPages ? Math.min(totalPages, 100) : 0;
            let hasMoreItems = firstPageData.hasMoreItems;

            const pageLimit = maxPages || 100;
            for (let pageNumber = 2; pageNumber <= pageLimit; pageNumber++) {
                if (maxPages === 0 && !hasMoreItems) break;
                try {
                    const pageData = await fetchActiveListings(authToken, pageNumber, 100);
                    totalItems += pageData.listings.length;
                    (pageData.listings || []).forEach((listing) => {
                        const status = listing?.status || 'UNKNOWN';
                        statusCounts[status] = (statusCounts[status] || 0) + 1;
                    });
                    console.info('[itemService] listings page fetched', {
                        ebayUserId,
                        page: pageNumber,
                        pageCount: pageData.listings.length,
                        statusCounts,
                    });
                    logSyncEvent('info', 'listings page fetched', {
                        ebayUserId,
                        page: pageNumber,
                        pageCount: pageData.listings.length,
                        statusCounts,
                    });
                    const pageSync = await updateItemsTable(pageData.listings, userId, ebayUserId);
                    logSyncEvent('info', 'listings page synced', {
                        ebayUserId,
                        page: pageNumber,
                        pageCount: pageData.listings.length,
                        updated: pageSync.updatedCount,
                        inserted: pageSync.insertedCount,
                        failed: pageSync.failedCount,
                    });
                    hasMoreItems = pageData.hasMoreItems;
                } catch (pageError) {
                    console.error(`Error fetching page ${pageNumber}:`, pageError.message);
                    logSyncEvent('error', 'listings page failed', {
                        ebayUserId,
                        page: pageNumber,
                        error: pageError.message,
                    });
                    await logSystemError({
                        error_code: 'EBAY_ACTIVE_LIST_PAGE_FAILED',
                        category: 'LISTINGS_SYNC',
                        provider: 'ebay',
                        message: `Error fetching page ${pageNumber}`,
                        user_id: userId,
                        payload_summary: { ebayUserId, page: pageNumber },
                        details: pageError.message,
                    });
                }
            }
            console.info('[itemService] account listings summary', {
                ebayUserId,
                totalEntries,
                statusCounts,
            });
            logSyncEvent('info', 'account listings summary', {
                userId,
                ebayUserId,
                totalEntries,
                statusCounts,
            });
        } catch (error) {
            console.error('Error during token refresh or fetching listings:', error.message);
            logSyncEvent('error', 'account sync failed', {
                userId,
                ebayUserId,
                error: error.message,
            });
            await logSystemError({
                error_code: 'EBAY_SYNC_FAILED',
                category: 'LISTINGS_SYNC',
                provider: 'ebay',
                message: 'Error during token refresh or fetching listings',
                user_id: userId,
                payload_summary: { ebayUserId },
                details: error.message,
            });
        }
    }

    console.log(`Total items fetched: ${totalItems}`);
    logSyncEvent('info', 'syncActiveListings complete', { userId, totalItems });
    return totalItems;
}




async function refreshEbayToken(refreshToken) {
    
    const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        scope: 'https://api.ebay.com/oauth/api_scope https://api.ebay.com/oauth/api_scope/sell.inventory.readonly https://api.ebay.com/oauth/api_scope/sell.inventory',
    });
    const response = await axios.post('https://api.ebay.com/identity/v1/oauth2/token', body.toString(), {
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
