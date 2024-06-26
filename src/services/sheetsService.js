const { google } = require('googleapis');
const { join } = require('path');
const supabase = require('../supabaseClient');
require('dotenv').config(); // .envファイルを読み込む

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

async function saveItems(items, userId) {
    try {
        const uniqueItems = Array.from(new Set(items.map(item => item.ebay_item_id)))
            .map(ebay_item_id => {
                const item = items.find(i => i.ebay_item_id === ebay_item_id);
                return {
                    ...item,
                    user_id: userId  // userIdを追加
                };
            });

        const { data, error } = await supabase
            .from('items')
            .upsert(uniqueItems, {
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
                    'ebay_user_id'
                ]
            });

        if (error) {
            throw error;
        }
        return data;
    } catch (error) {
        console.error('Error saving items to Supabase:', error.message);
        throw error;
    }
}

module.exports = {
    readFromSheet,
    saveItems
};
