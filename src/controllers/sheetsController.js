const { readFromSheet, saveItems } = require('../services/sheetsService');
const { logSystemError } = require('../services/systemErrorService');
const supabase = require('../supabaseClient');
const { parse, format, isValid } = require('date-fns');

// ユーザーIDに基づいてスプレッドシートのデータをSupabaseに同期する関数
async function syncSheetToSupabase(req, res) {
    const userId = req.body.userId;
    try {
        // accountsテーブルからユーザーのebay_user_idとspreadsheet_idを取得
        const { data: accounts, error: accountError } = await supabase
            .from('accounts')
            .select('ebay_user_id, spreadsheet_id')
            .eq('user_id', userId);

        if (accountError) {
            throw new Error(`Failed to fetch account data: ${accountError.message}`);
        }

        for (const account of accounts) {
            const { ebay_user_id, spreadsheet_id } = account;

            // ヘッダー行を読み取る
            const normalizeHeader = (value) => String(value || '')
                .trim()
                .replace(/\s+/g, '')
                .replace(/（/g, '(')
                .replace(/）/g, ')');
            const buildHeaderMap = (headersRow) => {
                const map = {};
                (headersRow || []).forEach((header, index) => {
                    map[normalizeHeader(header)] = index;
                });
                return map;
            };
            const headerScan = await readFromSheet(spreadsheet_id, 'A1:AZ5');
            let headerRowIndex = null;
            let headerMap = {};
            if (headerScan && headerScan.length) {
                for (let i = 0; i < headerScan.length; i += 1) {
                    const map = buildHeaderMap(headerScan[i]);
                    if (Object.keys(map).length === 0) {
                        continue;
                    }
                    if (map[normalizeHeader('商品タイトル')]) {
                        headerRowIndex = i;
                        headerMap = map;
                        break;
                    }
                }
            }
            if (headerRowIndex === null) {
                const headers = await readFromSheet(spreadsheet_id, 'A2:AZ2');
                headerMap = buildHeaderMap(headers?.[0]);
                headerRowIndex = 1;
            }

            const headerAliases = {
                title: ['商品タイトル'],
                stocking_url: ['仕入れURL', '仕入URL'],
                cost_price: ['仕入価格', '仕入れ価格'],
                ebay_url: ['eBayURL', 'ebayURL', 'eBay URL'],
                shipping_cost: ['目安送料'],
                estimated_length: ['縦(cm)', '縦 (cm)'],
                estimated_width: ['横(cm)', '横 (cm)'],
                estimated_height: ['高さ(cm)', '高さ (cm)'],
                estimated_weight: ['発送重量(g)', '発送重量 (g)', '発送重量（g）'],
                researcher: ['リサーチ担当'],
                exhibitor: ['出品担当'],
                exhibit_date: ['出品作業日'],
                research_date: ['リサーチ作業日'],
            };
            const getHeaderIndex = (aliases) => {
                for (const alias of aliases) {
                    const normalized = normalizeHeader(alias);
                    if (headerMap.hasOwnProperty(normalized)) {
                        return headerMap[normalized];
                    }
                }
                return null;
            };

            const headerIndexes = {};
            for (const [key, aliases] of Object.entries(headerAliases)) {
                const index = getHeaderIndex(aliases);
                if (index === null) {
                    const headerRowFallback = await readFromSheet(spreadsheet_id, 'A1:AZ1');
                    headerMap = buildHeaderMap(headerRowFallback?.[0]);
                    const fallbackIndex = getHeaderIndex(aliases);
                    if (fallbackIndex === null) {
                        const message = `Missing required header: ${aliases[0]}`;
                        await logSystemError({
                            error_code: 'SHEET_HEADER_MISSING',
                            category: 'SHEET_SYNC',
                            provider: 'google_sheets',
                            message,
                            user_id: userId,
                            payload_summary: { ebay_user_id, spreadsheet_id },
                            details: { missingHeader: aliases[0] },
                        });
                        throw new Error(message);
                    }
                    headerIndexes[key] = fallbackIndex;
                } else {
                    headerIndexes[key] = index;
                }
            }

            // データ行を読み取る
            const dataStartRow = headerRowIndex + 2;
            const rows = await readFromSheet(spreadsheet_id, `A${dataStartRow}:AZ`);

            // 空行をフィルタリング
            const itemsFromSheet = rows
                .filter(row => row && row.length >= Object.keys(headerIndexes).length && row[headerIndexes.ebay_url]) // 空行や不完全な行、eBay URLが空白の行を除外
                .map(row => {
                    const title = row[headerIndexes.title] || '';
                    const stocking_url = row[headerIndexes.stocking_url] || '';
                    const cost_price = row[headerIndexes.cost_price] || '';
                    const ebay_url = row[headerIndexes.ebay_url] || '';
                    const shipping_cost = row[headerIndexes.shipping_cost] || '';
                    const estimated_length = row[headerIndexes.estimated_length] || '';
                    const estimated_width = row[headerIndexes.estimated_width] || '';
                    const estimated_height = row[headerIndexes.estimated_height] || '';
                    const estimated_weight = row[headerIndexes.estimated_weight] || '';
                    const researcher = row[headerIndexes.researcher] || '';
                    const exhibitor = row[headerIndexes.exhibitor] || '';
                    const exhibit_date = row[headerIndexes.exhibit_date];
                    const research_date = row[headerIndexes.research_date];
                    const formattedShippingPrice = parseInt(shipping_cost.replace(/[^0-9]/g, '')) || 0; // ¥や,を除去
                    const formattedCostPrice = parseInt(cost_price.replace(/[^0-9]/g, '')) || 0; // ¥や,を除去
                    const formattedLength = parseInt(String(estimated_length).replace(/[^0-9]/g, '')) || 0;
                    const formattedWidth = parseInt(String(estimated_width).replace(/[^0-9]/g, '')) || 0;
                    const formattedHeight = parseInt(String(estimated_height).replace(/[^0-9]/g, '')) || 0;
                    const formattedWeight = parseInt(String(estimated_weight).replace(/[^0-9]/g, '')) || 0;
                    const ebay_item_id_match = ebay_url.match(/\/(\d+)(?:[\/?]|$)/);
                    const ebay_item_id = ebay_item_id_match ? ebay_item_id_match[1] : '';

                    return {
                        title,
                        stocking_url,
                        cost_price: formattedCostPrice,
                        ebay_item_id,
                        estimated_shipping_cost: formattedShippingPrice,
                        estimated_parcel_length: formattedLength || null,
                        estimated_parcel_width: formattedWidth || null,
                        estimated_parcel_height: formattedHeight || null,
                        estimated_parcel_weight: formattedWeight || null,
                        researcher,
                        exhibitor,
                        exhibit_date,
                        research_date,
                        ebay_user_id
                    };
                });

            await saveItems(itemsFromSheet, userId);
        }
        res.status(200).send('Items successfully saved to Supabase');
    } catch (error) {
        console.error('Error syncing sheet to Supabase:', error.message);
        await logSystemError({
            error_code: 'SHEET_SYNC_FAILED',
            category: 'SHEET_SYNC',
            provider: 'google_sheets',
            message: error.message,
            user_id: userId,
            details: error.stack || error.message,
        });
        res.status(500).send(`Error syncing sheet to Supabase: ${error.message}`);
    }
}

module.exports = {
    syncSheetToSupabase
};
