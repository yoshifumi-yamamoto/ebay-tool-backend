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
            const sheetName = '出品 年月';
            const sheetRange = (range) => `'${sheetName}'!${range}`;
            const headerScan = await readFromSheet(spreadsheet_id, sheetRange('A1:AZ20'));
            let headerRowIndex = null;
            let headerMap = {};
            if (headerScan && headerScan.length) {
                for (let i = 0; i < headerScan.length; i += 1) {
                    const map = buildHeaderMap(headerScan[i]);
                    if (Object.keys(map).length === 0) {
                        continue;
                    }
                    if (map[normalizeHeader('商品タイトル')] !== undefined) {
                        headerRowIndex = i;
                        headerMap = map;
                        break;
                    }
                }
            }
            if (headerRowIndex === null) {
                const message = `Header row not found in ${sheetName} A1:AZ20`;
                await logSystemError({
                    error_code: 'SHEET_HEADER_NOT_FOUND',
                    category: 'SHEET_SYNC',
                    provider: 'google_sheets',
                    message,
                    user_id: userId,
                    payload_summary: { ebay_user_id, spreadsheet_id },
                    details: { scannedRows: headerScan?.length || 0 },
                });
                throw new Error(message);
            }
            console.info('[sheets] header scan result', {
                ebay_user_id,
                spreadsheet_id,
                headerRowIndex,
                headerKeys: Object.keys(headerMap || {}),
            });

            const headerAliases = {
                title: ['商品タイトル'],
                stocking_url: ['仕入れURL', '仕入URL'],
                cost_price: ['仕入価格', '仕入れ価格'],
                ebay_url: ['eBayURL', 'ebayURL', 'eBay URL'],
                ebay_item_id: ['eBayItemID', 'eBay Item ID', 'eBayItemId', 'eBay ItemID'],
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

            const fetchActiveItemIds = async () => {
                const ids = [];
                const pageSize = 1000;
                let offset = 0;
                const retryLimit = 3;
                const retryDelayMs = 500;
                for (let page = 0; page < 200; page += 1) {
                    let data = null;
                    let error = null;
                    for (let attempt = 1; attempt <= retryLimit; attempt += 1) {
                        const response = await supabase
                            .from('items')
                            .select('ebay_item_id')
                            .eq('user_id', userId)
                            .eq('ebay_user_id', ebay_user_id)
                            .eq('listing_status', 'ACTIVE')
                            .order('ebay_item_id', { ascending: true })
                            .range(offset, offset + pageSize - 1);
                        data = response?.data || null;
                        error = response?.error || null;
                        if (!error) {
                            break;
                        }
                        if (attempt < retryLimit) {
                            await new Promise(resolve => setTimeout(resolve, retryDelayMs));
                        }
                    }
                    if (error) {
                        throw new Error(`Failed to fetch active items: ${error.message}`);
                    }
                    const pageIds = (data || []).map((item) => item.ebay_item_id).filter(Boolean);
                    ids.push(...pageIds);
                    if (pageIds.length < pageSize) {
                        break;
                    }
                    offset += pageSize;
                }
                return ids;
            };

            const activeItemIds = await fetchActiveItemIds();
            const activeItemIdSet = new Set(activeItemIds);

            // データ行を読み取る
            const dataStartRow = headerRowIndex + 2;
            const rows = await readFromSheet(spreadsheet_id, sheetRange(`A${dataStartRow}:AZ`));

            // 空行をフィルタリング
            const rowsSafe = Array.isArray(rows) ? rows : [];
            let skippedMissingEbayId = 0;
            let skippedNotActiveOrRecent = 0;
            let skippedShortRow = 0;
            const now = new Date();
            const recentCutoff = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
            const recentRowThreshold = 1000;
            const recentRowIndex = Math.max(rowsSafe.length - recentRowThreshold, 0);
            const parseSheetDate = (value) => {
                if (!value) return null;
                const trimmed = String(value).trim();
                if (!trimmed) return null;
                if (/^\d{1,2}\/\d{1,2}$/.test(trimmed)) {
                    const [month, day] = trimmed.split('/').map((part) => parseInt(part, 10));
                    if (!isNaN(month) && !isNaN(day)) {
                        const year = now.getFullYear();
                        const mm = String(month).padStart(2, '0');
                        const dd = String(day).padStart(2, '0');
                        return new Date(`${year}-${mm}-${dd}`);
                    }
                }
                if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(trimmed)) {
                    const [year, month, day] = trimmed.split('/').map((part) => parseInt(part, 10));
                    if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
                        const mm = String(month).padStart(2, '0');
                        const dd = String(day).padStart(2, '0');
                        return new Date(`${year}-${mm}-${dd}`);
                    }
                }
                if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
                    return new Date(trimmed);
                }
                return null;
            };
            const itemsFromSheet = rowsSafe
                .filter((row, index) => {
                    if (!row || row.length < Object.keys(headerIndexes).length) {
                        skippedShortRow += 1;
                        return false;
                    }
                    const ebayItemIdCell = headerIndexes.ebay_item_id != null
                        ? row[headerIndexes.ebay_item_id]
                        : '';
                    const ebayUrlCell = row[headerIndexes.ebay_url] || '';
                    const ebayItemIdFromUrl = ebayUrlCell.match(/\/(\d+)(?:[\/?]|$)/);
                    const ebayItemId = String(ebayItemIdCell || ebayItemIdFromUrl?.[1] || '').trim();
                    if (!ebayItemId) {
                        skippedMissingEbayId += 1;
                        return false;
                    }
                    const isActive = activeItemIdSet.has(ebayItemId);
                    const isRecentRow = index >= recentRowIndex;
                    const exhibitDateValue = row[headerIndexes.exhibit_date];
                    const exhibitDate = parseSheetDate(exhibitDateValue);
                    const isRecentExhibit = exhibitDate ? exhibitDate >= recentCutoff : false;
                    if (!isActive && !isRecentRow && !isRecentExhibit) {
                        skippedNotActiveOrRecent += 1;
                        return false;
                    }
                    return true;
                }) // 空行や不完全な行、eBay URLが空白の行を除外
                .map(row => {
                    const title = row[headerIndexes.title] || '';
                    const stocking_url = row[headerIndexes.stocking_url] || '';
                    const cost_price = row[headerIndexes.cost_price] || '';
                    const ebay_url = row[headerIndexes.ebay_url] || '';
                    const ebay_item_id_cell = headerIndexes.ebay_item_id != null
                        ? row[headerIndexes.ebay_item_id]
                        : '';
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
                    const ebay_item_id = String(ebay_item_id_cell || ebay_item_id_match?.[1] || '').trim();

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

            console.info('[sheets] sync summary', {
                ebay_user_id,
                spreadsheet_id,
                rowsRead: rowsSafe.length,
                rowsKept: itemsFromSheet.length,
                skippedMissingEbayId,
                skippedShortRow,
                skippedNotActiveOrRecent,
                activeItemCount: activeItemIdSet.size,
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
