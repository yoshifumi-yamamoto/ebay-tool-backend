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

    const trimmed = String(dateString).trim();
    if (!trimmed) {
        return null;
    }

    // Handle M/D or M/DD (assume current year)
    if (/^\d{1,2}\/\d{1,2}$/.test(trimmed)) {
        const [month, day] = trimmed.split('/').map((part) => parseInt(part, 10));
        if (!isNaN(month) && !isNaN(day)) {
            const now = new Date();
            const year = now.getFullYear();
            const mm = String(month).padStart(2, '0');
            const dd = String(day).padStart(2, '0');
            return `${year}-${mm}-${dd}`;
        }
    }

    // Check if the dateString is in 'YYYY/MM/DD' format
    if (/^\d{4}\/\d{2}\/\d{2}$/.test(trimmed)) {
        const parts = trimmed.split('/');
        if (parts.length === 3) {
            const [year, month, day] = parts;
            if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
                return `${year}-${month}-${day}`;
            }
        }
    }

    // Check if the dateString is already in 'YYYY-MM-DD' format
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return trimmed;
    }

    console.error(`Invalid date format: ${trimmed}`);
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

        const batchSize = 20; // バッチサイズを設定
        const batchDelayMs = 200;
        const retryLimit = 3;
        const retryDelayMs = 500;
        for (let i = 0; i < uniqueItems.length; i += batchSize) {
            const batch = uniqueItems.slice(i, i + batchSize);
            let error = null;
            for (let attempt = 1; attempt <= retryLimit; attempt += 1) {
                const response = await supabase
                    .from('items')
                    .upsert(batch, {
                        onConflict: ['ebay_item_id', 'user_id'], // user_idも衝突対象に追加
                        updateColumns: [
                            'title',
                            'stocking_url',
                            'cost_price',
                            'estimated_shipping_cost',
                            'estimated_parcel_length',
                            'estimated_parcel_width',
                            'estimated_parcel_height',
                            'estimated_parcel_weight',
                            'researcher',
                            'exhibitor',
                            'exhibit_date',
                            'research_date',
                            'ebay_user_id',
                            'updated_at'
                        ]
                    });
                error = response?.error || null;
                if (!error) {
                    break;
                }
                if (attempt < retryLimit) {
                    await new Promise(resolve => setTimeout(resolve, retryDelayMs));
                }
            }

            if (error) {
                // エラー発生時、バッチ内の個々のアイテムで `upsert` を試みる
                console.log("----------error---------");
                // console.log(batch);
                for (const item of batch) {
                    try {
                        let itemError = null;
                        for (let attempt = 1; attempt <= retryLimit; attempt += 1) {
                            const { error: attemptError } = await supabase
                                .from('items')
                                .upsert(item, {
                                    onConflict: ['ebay_item_id', 'user_id'],
                                    updateColumns: [
                                        'title',
                                        'stocking_url',
                                        'cost_price',
                                        'estimated_shipping_cost',
                                        'estimated_parcel_length',
                                        'estimated_parcel_width',
                                        'estimated_parcel_height',
                                        'estimated_parcel_weight',
                                        'researcher',
                                        'exhibitor',
                                        'exhibit_date',
                                        'research_date',
                                        'ebay_user_id',
                                        'updated_at'
                                    ]
                                });
                            itemError = attemptError || null;
                            if (!itemError) {
                                break;
                            }
                            if (attempt < retryLimit) {
                                await new Promise(resolve => setTimeout(resolve, retryDelayMs));
                            }
                        }

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
            await new Promise(resolve => setTimeout(resolve, batchDelayMs));
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
