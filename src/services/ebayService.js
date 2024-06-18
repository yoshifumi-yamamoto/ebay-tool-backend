const axios = require('axios');
const supabase = require('../supabaseClient');
const { getRefreshTokenByEbayUserId, refreshEbayToken } = require('./accountService');
const xml2js = require('xml2js');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');
const { uploadFileToGoogleDrive } = require('./googleDriveService');

// 日付を付けたファイル名を生成
const fileName = `inventory_update_results_${new Date().toISOString().split('T')[0]}.csv`;

// CSVライターの設定
const csvWriter = createCsvWriter({
    path: path.join(__dirname, fileName),
    header: [
        {id: 'itemId', title: 'ItemID'},
        {id: 'stockUrl', title: 'StockUrl'},
        {id: 'stockStatus', title: 'StockStatus'},
        {id: 'quantity', title: 'Quantity'},
        {id: 'status', title: 'Status'},
        {id: 'errorCode', title: 'ErrorCode'},
        {id: 'shortMessage', title: 'ShortMessage'},
        {id: 'longMessage', title: 'LongMessage'}
    ]
});

const updateEbayInventoryTradingAPI = async (userId, ebayUserId, inventoryData, folderId) => {
    try {
        const refreshToken = await getRefreshTokenByEbayUserId(ebayUserId);
        if (!refreshToken) throw new Error('No refresh token found for eBay user ID: ' + ebayUserId);

        const accessToken = await refreshEbayToken(refreshToken);

        const batchSize = 3;  // 一度に送信するアイテムの数
        const results = [];  // 結果を格納する配列

        for (let i = 0; i < inventoryData.length; i += batchSize) {
            const batch = inventoryData.slice(i, i + batchSize);

            const xmlRequest = `
                <?xml version="1.0" encoding="utf-8"?>
                <ReviseInventoryStatusRequest xmlns="urn:ebay:apis:eBLBaseComponents">
                    <RequesterCredentials>
                        <eBayAuthToken>${accessToken}</eBayAuthToken>
                    </RequesterCredentials>
                    ${batch.map(item => `
                    <InventoryStatus>
                        <ItemID>${item.itemId}</ItemID>
                        <Quantity>${item.quantity}</Quantity>
                    </InventoryStatus>`).join('')}
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

            const parser = new xml2js.Parser();
            const responseData = await parser.parseStringPromise(response.data);
            const errors = responseData.ReviseInventoryStatusResponse.Errors || [];

            const updatePromises = batch.map(async item => {
                const itemId = item.itemId;
                const itemErrors = errors.filter(err => 
                    err.ErrorParameters.some(param => param.Value.includes(itemId))
                );


                if (itemErrors.length > 0) {
                    for (const error of itemErrors) {
                        console.log(`Skipping ended item: ${itemId}`);
                        await supabase
                            .from('items')
                            .update({
                                stock_status: 'ended',
                                last_update: new Date().toISOString()
                            })
                            .eq('ebay_item_id', itemId)
                            .eq('user_id', userId);

                        // 結果を追加
                        results.push({
                            itemId: itemId,
                            stockUrl: item.url,
                            stockStatus: item.stockStatus,
                            quantity: item.quantity,
                            status: 'error',
                            errorCode: error.ErrorCode[0],
                            shortMessage: error.ShortMessage[0],
                            longMessage: error.LongMessage[0]
                        });
                    }
                } else {
                    await supabase
                        .from('items')
                        .update({
                            stock_status: item.stockStatus,
                            last_update: new Date().toISOString()
                        })
                        .eq('ebay_item_id', itemId)
                        .eq('user_id', userId);

                    // 結果を追加
                    results.push({
                        itemId: itemId,
                        stockUrl: item.url,
                        stockStatus: item.stockStatus,
                        quantity: item.quantity,
                        status: 'success',
                        errorCode: null,
                        shortMessage: null,
                        longMessage: null
                    });
                }
            });

            await Promise.all(updatePromises);
        }

        // CSVファイルに書き込む
        await csvWriter.writeRecords(results);

        // Googleドライブにファイルをアップロード
        await uploadFileToGoogleDrive(path.join(__dirname, fileName), folderId);

        return true;
    } catch (error) {
        console.error('eBay在庫更新エラー:', error.response ? error.response.data : error.message);
        throw error;
    }
};

module.exports = {
    updateEbayInventoryTradingAPI
};
