const axios = require('axios');
const supabase = require('../supabaseClient');
const { getRefreshTokenByEbayUserId, refreshEbayToken } = require('./accountService');

const updateEbayInventoryTradingAPI = async (userId, ebayUserId, inventoryData) => {
    try {
        // eBayアカウントのリフレッシュトークンを取得
        const refreshToken = await getRefreshTokenByEbayUserId(ebayUserId);
        if (!refreshToken) throw new Error('No refresh token found for eBay user ID: ' + ebayUserId);

        const accessToken = await refreshEbayToken(refreshToken);

        // バッチ処理のサイズを定義
        const batchSize = 50; // 適宜調整

        // バッチ処理用の配列を作成
        const batches = [];
        for (let i = 0; i < inventoryData.length; i += batchSize) {
            batches.push(inventoryData.slice(i, i + batchSize));
        }

        // バッチごとに非同期でリクエストを送信
        const promises = batches.map(async (batch) => {
            const xmlRequests = batch.map(item => `
                <InventoryStatus>
                    <ItemID>${item.itemId}</ItemID>
                    <Quantity>${item.quantity}</Quantity>
                </InventoryStatus>
            `).join('');

            const xmlRequest = `
                <?xml version="1.0" encoding="utf-8"?>
                <ReviseInventoryStatusRequest xmlns="urn:ebay:apis:eBLBaseComponents">
                    <RequesterCredentials>
                        <eBayAuthToken>${accessToken}</eBayAuthToken>
                    </RequesterCredentials>
                    ${xmlRequests}
                </ReviseInventoryStatusRequest>`;

            const response = await axios({
                method: 'post',
                url: 'https://api.ebay.com/ws/api.dll',
                headers: {
                    'X-EBAY-API-CALL-NAME': 'ReviseInventoryStatus',
                    'X-EBAY-API-SITEID': '0',
                    'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
                    'Content-Type': 'text/xml'
                },
                data: xmlRequest
            });

            console.log('eBay在庫更新レスポンス:', response.data);

            // 在庫更新日と判定結果をSupabaseのitemsテーブルに保存
            const updatePromises = batch.map(item => 
                supabase
                .from('items')
                .update({
                    stock_status: item.stockStatus,
                    last_update: new Date().toISOString()
                })
                .eq('ebay_item_id', item.itemId)
                .eq('user_id', userId)
            );

            await Promise.all(updatePromises);
        });

        // すべてのリクエストが完了するのを待つ
        await Promise.all(promises);

        return true;
    } catch (error) {
        console.error('eBay在庫更新エラー:', error.response ? error.response.data : error.message);
        throw error;
    }
};

module.exports = {
    updateEbayInventoryTradingAPI
};
