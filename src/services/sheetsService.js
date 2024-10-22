const { google } = require('googleapis');
const { join } = require('path');
const supabase = require('../supabaseClient');
require('dotenv').config(); // .envファイルを読み込む
const { logError } = require('./loggingService');

// サービスアカウントキーのパス
const SERVICE_ACCOUNT_FILE = join(__dirname, '../../credentials/service-account-key.json');

// 認証クライアントを設定
const auth = new google.auth.GoogleAuth({
    keyFile: SERVICE_ACCOUNT_FILE,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

// データを読み取る関数
async function readFromSheet(spreadsheetId, range) {
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });

    const request = {
        spreadsheetId,
        range,
    };

    try {
        const response = await sheets.spreadsheets.values.get(request);
        return response.data.values;
    } catch (error) {
        console.error('Error reading sheet:', error);
        throw error;
    }
}

function formatDateString(dateString) {
    if (!dateString) {
        return null; // 空の場合はnullを返す
    }

    // Check if the dateString is in 'YYYY/MM/DD' format
    if (/^\d{4}\/\d{2}\/\d{2}$/.test(dateString)) {
        const parts = dateString.split('/');
        if (parts.length === 3) {
            const [year, month, day] = parts;
            if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
                return `${year}-${month}-${day}`;
            }
        }
    }

    // Check if the dateString is already in 'YYYY-MM-DD' format
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        return dateString;
    }

    console.error(`Invalid date format: ${dateString}`);
    return null; // 無効な日付フォーマットの場合もnullを返す
}

async function saveItems(items, userId) {
    try {
        const uniqueItems = Array.from(new Set(items.map(item => item.ebay_item_id)))
            .map(ebay_item_id => {
                const item = items.find(i => i.ebay_item_id === ebay_item_id);
                return {
                    ...item,
                    user_id: userId,  // userIdを追加
                    exhibit_date: item.exhibit_date ? formatDateString(item.exhibit_date) : null,  // exhibit_dateをフォーマット
                    research_date: item.research_date ? formatDateString(item.research_date) : null,  // research_dateをフォーマット
                    updated_at: new Date().toISOString()  // updated_atを追加
                };
            });

        const batchSize = 1000; // バッチサイズを設定
        for (let i = 0; i < uniqueItems.length; i += batchSize) {
            const batch = uniqueItems.slice(i, i + batchSize);
            const { data, error } = await supabase
                .from('items')
                .upsert(batch, {
                    onConflict: ['ebay_item_id', 'user_id'], // user_idも衝突対象に追加
                    updateColumns: [
                        'title', 
                        'stocking_url', 
                        'cost_price', 
                        'shipping_cost', 
                        'researcher', 
                        'exhibitor', 
                        'exhibit_date', 
                        'research_date', 
                        'ebay_user_id',
                        'updated_at'  // updated_atを追加
                    ]
                });

            if (error) {
                // エラー発生時、バッチ内の個々のアイテムで `upsert` を試みる
                console.log("----------error---------");
                // console.log(batch);
                for (const item of batch) {
                    try {
                        const { error: itemError } = await supabase
                            .from('items')
                            .upsert(item, {
                                onConflict: ['ebay_item_id', 'user_id'],
                                updateColumns: [
                                    'title',
                                    'stocking_url',
                                    'cost_price',
                                    'shipping_cost',
                                    'researcher',
                                    'exhibitor',
                                    'exhibit_date',
                                    'research_date',
                                    'ebay_user_id',
                                    'updated_at'
                                ]
                            });

                        if (itemError) {
                            console.log("Error upserting item:", item);
                            console.log("Item error:", itemError.message);
                            await logError({
                                itemId: item,  // itemIdをログに追加
                                errorType: 'API_ERROR',
                                errorMessage: error.message,
                                attemptNumber: 1,  // 任意のリトライ回数を指定可能
                                additionalInfo: {
                                    functionName: 'saveItems',
                                }
                            });
                        }
                    } catch (innerError) {
                        console.error("Unexpected error during individual upsert:", innerError.message);

                        await logError({
                            itemId: "NA",  // itemIdをログに追加
                            errorType: 'API_ERROR',
                            errorMessage: error.message,
                            attemptNumber: 1,  // 任意のリトライ回数を指定可能
                            additionalInfo: {
                                functionName: 'saveItems',
                            }
                        });
                    }
                }
                throw error;
            }
        }
        return true;
    } catch (error) {
        console.error('Error saving items to Supabase:', error.message);
        throw error;
    }
}


module.exports = {
    readFromSheet,
    saveItems
};
