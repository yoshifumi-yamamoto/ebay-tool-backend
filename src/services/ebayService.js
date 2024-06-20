const axios = require('axios');
const supabase = require('../supabaseClient');
const { getRefreshTokenByEbayUserId, refreshEbayToken } = require('./accountService');
const xml2js = require('xml2js');

const updateEbayInventoryTradingAPI = async (userId, ebayUserId, inventoryData, taskId, folderId) => {
    try {
        const refreshToken = await getRefreshTokenByEbayUserId(ebayUserId);
        if (!refreshToken) throw new Error('No refresh token found for eBay user ID: ' + ebayUserId);

        const accessToken = await refreshEbayToken(refreshToken);

        const batchSize = 3;  // 一度に送信するアイテムの数
        const results = [];  // 結果を格納する配列

        for (let i = 0; i < inventoryData.length; i += batchSize) {
            const batch = inventoryData.slice(i, i + batchSize).filter(item => item !== undefined);

            // console.log("batch", batch);
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

            const parser = new xml2js.Parser();
            const responseData = await parser.parseStringPromise(response.data);
            const errors = responseData.ReviseInventoryStatusResponse.Errors || [];
            // console.log("Errors received: ", errors);

            const updatePromises = batch.map(async item => {
                const itemId = item.itemId;
                console.log("Processing item: ", item);
                const itemErrors = errors.filter(err => 
                    err.ErrorParameters && err.ErrorParameters.some(param => param.Value.includes(itemId))
                );

                if (itemErrors.length > 0) {
                    console.log(`Errors found for itemId: ${itemId}`, itemErrors);

                    for (const error of itemErrors) {
                        // console.log(`Processing error for item: ${itemId}`);
                        await supabase
                            .from('items')
                            .update({
                                stock_status: item.stockStatus,
                                item_status: error.ErrorCode[0],
                                last_update: new Date().toISOString()
                            })
                            .eq('ebay_item_id', itemId)
                            .eq('user_id', userId);

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
                    console.log(`Success for item: ${itemId}`);
                    await supabase
                        .from('items')
                        .update({
                            stock_status: item.stockStatus,
                            item_status: "ACTIVE",
                            last_update: new Date().toISOString()
                        })
                        .eq('ebay_item_id', itemId)
                        .eq('user_id', userId);

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

            // `undefined` なアイテムをエラーとして追加
            inventoryData.slice(i, i + batchSize).filter(item => item === undefined).forEach(item => {
                results.push({
                    itemId: "",
                    stockUrl: item.url,
                    stockStatus: item.stockStatus,
                    quantity: 0,
                    status: 'error',
                    errorCode: 999,
                    shortMessage: "item does not match",
                    longMessage: "No matching itemId found"
                });
            });
        }

        // 結果と成功、失敗のカウントを返す
        const successCount = results.filter(result => result.status === 'success').length;
        const failureCount = results.filter(result => result.status === 'error').length;

        return { results, successCount, failureCount };
    } catch (error) {
        console.error('eBay在庫更新エラー:', error.response ? error.response.data : error.message);
        throw error;
    }
};


module.exports = {
    updateEbayInventoryTradingAPI
};
