const csv = require('csv-parser');
const { randomUUID } = require('crypto');
const supabase = require('../supabaseClient');

const batchSize = 100; // バッチサイズを設定
const concurrencyLimit = 5; // 並行処理のリミットを設定
const DEFAULT_CUSTOMS_RATIO_THRESHOLD = Number(process.env.CARRIER_ANOMALY_CUSTOMS_RATIO_THRESHOLD) || 0.2;
const DEFAULT_FEE_RATIO_THRESHOLD = Number(process.env.CARRIER_ANOMALY_FEE_RATIO_THRESHOLD) || 0.6;
const DEFAULT_FEE_RATIO_MIN_FEE_AMOUNT = Number(process.env.CARRIER_ANOMALY_FEE_RATIO_MIN_FEE_AMOUNT) || 2000;
const DEFAULT_FEE_RATIO_MIN_SHIPPING_AMOUNT = Number(process.env.CARRIER_ANOMALY_FEE_RATIO_MIN_SHIPPING_AMOUNT) || 3000;
const DEFAULT_UNKNOWN_OTHER_MIN_ABS_AMOUNT = Number(process.env.CARRIER_ANOMALY_UNKNOWN_OTHER_MIN_ABS_AMOUNT) || 300;
const ENV_EXCHANGE_RATES = {
    USD: Number(process.env.EXCHANGE_RATE_USD_TO_JPY) || 150,
    EUR: Number(process.env.EXCHANGE_RATE_EUR_TO_JPY) || null,
    CAD: Number(process.env.EXCHANGE_RATE_CAD_TO_JPY) || null,
    GBP: Number(process.env.EXCHANGE_RATE_GBP_TO_JPY) || null,
    AUD: Number(process.env.EXCHANGE_RATE_AUD_TO_JPY) || null,
    JPY: 1,
};
const DEFAULT_OTHER_LABEL_ALLOWLIST = (
    process.env.CARRIER_ANOMALY_OTHER_LABEL_ALLOWLIST ||
    '割引額,discount,rebate'
)
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isTransientFetchError(error) {
    if (!error) return false;
    const msg = String(error.message || error).toLowerCase();
    return (
        msg.includes('fetch failed') ||
        msg.includes('network') ||
        msg.includes('etimedout') ||
        msg.includes('econnreset') ||
        msg.includes('enotfound')
    );
}

async function runWithRetry(task, label, maxAttempts = 3) {
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            return await task();
        } catch (error) {
            lastError = error;
            const shouldRetry = isTransientFetchError(error) && attempt < maxAttempts;
            if (!shouldRetry) break;
            const waitMs = 200 * attempt;
            console.warn(`[carrier-invoice] retrying ${label} (${attempt}/${maxAttempts}) after transient error: ${error.message}`);
            await sleep(waitMs);
        }
    }
    throw lastError;
}

async function processBatches(updates, type) {
    const promises = [];

    for (let i = 0; i < updates.length; i += batchSize) {
        let batch = updates.slice(i, i + batchSize);

        if (type === 'category') {
            // report_monthフィールドを除外
            batch = batch.map(({ report_month, ...rest }) => rest);
        }

        let promise;
        if (type === 'category') {
            promise = supabase.from('items').upsert(batch, {
                onConflict: ['ebay_item_id'],
            });
        } else if (type === 'traffic') {
            promise = supabase.from('traffic_history').upsert(batch, {
                onConflict: ['ebay_item_id', 'report_month'], // item_id と月でユニークになるように設定
            });
        }

        promise.then(({ data, error }) => {
            if (error) {
                console.error(`Error upserting batch ${Math.ceil((i + 1) / batchSize)} for ${type}:`, error.message);
            } else {
                console.log(`Batch ${Math.ceil((i + 1) / batchSize)} for ${type} upserted successfully.`);
            }
        });

        promises.push(promise);

        if (promises.length >= concurrencyLimit) {
            await Promise.all(promises);
            promises.length = 0;
        }
    }

    if (promises.length > 0) {
        await Promise.all(promises);
    }

    console.log(`Successfully processed ${updates.length} ${type} updates.`);
}

async function updateItemsTable(updates) {
    await processBatches(updates, 'category');
}

async function migrateToTrafficHistory(updates) {
    await processBatches(updates, 'traffic');
}

async function updateTrafficHistory(updates) {
    // すべての更新を一括で処理するためにバッチ処理
    const batches = [];

    for (let i = 0; i < updates.length; i += batchSize) {
        const batch = updates.slice(i, i + batchSize);
        batches.push(batch);
    }

    for (const batch of batches) {
        const { data, error } = await supabase.from('traffic_history').upsert(batch, {
            onConflict: ['ebay_item_id', 'report_month', 'ebay_user_id'],
        });

        if (error) {
            console.error('Error upserting batch for traffic:', error.message);
        } else {
            console.log(`Successfully upserted batch with ${batch.length} records.`);
        }
    }

    console.log(`Successfully processed ${updates.length} traffic history records.`);
}




async function updateCategoriesFromCSV(fileBuffer, report_month, ebay_user_id, user_id) {
    const results = [];

    fileBuffer
        .pipe(csv({
            mapHeaders: ({ header }) => header.trim().replace(/^"|"$/g, '').replace(/^\uFEFF/, '')
        }))
        .on('data', (data) => {
            if (results.length === 0) {
                console.log('Headers:', Object.keys(data)); // ヘッダー名を出力
            }
            results.push(data);
        })
        .on('end', async () => {
            const updates = results.map(row => ({
                ebay_item_id: row['Item number'],
                category_id: row['eBay category 1 number'],
                category_name: row['eBay category 1 name'],
                report_month,
                ebay_user_id,
                // user_id: userId // user_id を付与
            })).filter(update => update.ebay_item_id);

            // itemsテーブルにカテゴリ情報をアップサート
            await updateItemsTable(updates);

            // traffic_historyテーブルにカテゴリ情報を更新
            await updateTrafficHistory(updates);

            console.log('CSV processing for categories completed.');
        });
}

async function updateTrafficFromCSV(fileBuffer, report_month, ebay_user_id, userId) {
    const results = [];

    fileBuffer
        .pipe(csv({
            mapHeaders: ({ header }) => header.trim().replace(/^"|"$/g, '').replace(/^\uFEFF/, '')
        }))
        .on('data', (data) => {
            if (results.length === 0) {
                console.log('Headers:', Object.keys(data)); // ヘッダー名を出力
            }
            results.push(data);
        })
        .on('end', async () => {
            const updates = results.map(row => {
                let salesConversionRate = row['Sales conversion rate = Quantity sold/Total page views'];
                if (salesConversionRate === '-' || !salesConversionRate || salesConversionRate.trim() === '') {
                    salesConversionRate = null;
                } else {
                    salesConversionRate = parseFloat(salesConversionRate.replace('%', '').trim()) / 100.0;
                }

                return {
                    ebay_item_id: row['eBay item ID'],
                    report_month,
                    ebay_user_id, // 引数で受け取ったebay_user_idを使用
                    user_id: userId, // user_id を付与
                    listing_title: row['Listing title'],
                    current_promoted_listings_status: row['Current promoted listings status'],
                    quantity_available: parseInt(row['Quantity available'], 10) || 0,
                    total_impressions_on_ebay_site: parseInt(row['Total impressions on eBay site'], 10) || 0,
                    click_through_rate: parseFloat(row['Click-through rate = Page views from eBay site/Total impressions'].replace('%', '').trim()) / 100.0 || 0,
                    quantity_sold: parseInt(row['Quantity sold'], 10) || 0,
                    sales_conversion_rate: salesConversionRate,
                    top_20_search_spot_impressions_from_promoted_listings: parseInt(row['Top 20 search spot impressions from promoted listings'], 10) || 0,
                    percent_change_in_top_20_search_spot_impressions_from_promoted_: parseFloat(row['% Change in Top 20 search spot impressions from promoted listings'].replace('%', '').trim()) || 0,
                    top_20_search_spot_organic_impressions: parseInt(row['Top 20 search spot organic impressions'], 10) || 0,
                    percent_change_in_top_20_search_spot_organic_impressions: parseFloat(row['% Change in Top 20 search spot impressions'].replace('%', '').trim()) || 0,  // 修正部分
                    rest_of_search_spot_impressions: parseInt(row['Rest of search spot impressions'], 10) || 0,
                    non_search_promoted_listings_impressions: parseInt(row['Non-search promoted listings impressions'], 10) || 0,
                    percent_change_in_non_search_promoted_listings_impressions: parseFloat(row['% Change in non-search promoted listings impressions'].replace('%', '').trim()) || 0,
                    non_search_organic_impressions: parseInt(row['Non-search organic impressions'], 10) || 0,
                    percent_change_in_non_search_organic_impressions: parseFloat(row['% Change in non-search organic impressions'].replace('%', '').trim()) || 0,
                    total_promoted_listings_impressions: parseInt(row['Total promoted listings impressions (applies to eBay site only)'], 10) || 0,
                    total_organic_impressions_on_ebay_site: parseInt(row['Total organic impressions on eBay site'], 10) || 0,
                    total_page_views: parseInt(row['Total page views'], 10) || 0,
                    page_views_via_promoted_listings_impressions_on_ebay_site: parseInt(row['Page views via promoted listings impressions on eBay site'], 10) || 0,
                    page_views_via_promoted_listings_impressions_from_outside_ebay: parseInt(row['Page views via promoted listings Impressions from outside eBay (search engines, affiliates)'], 10) || 0,
                    page_views_via_organic_impressions_on_ebay_site: parseInt(row['Page views via organic impressions on eBay site'], 10) || 0,
                    page_views_from_organic_impressions_outside_ebay: parseInt(row['Page views from organic impressions outside eBay (Includes page views from search engines)'], 10) || 0,
                };
            });

            if (updates.length > 0) {
                await migrateToTrafficHistory(updates);
            }

            console.log('CSV processing for traffic completed.');
        });
}

async function updateActiveListingsCSV(fileBuffer) {
    const results = [];

    // CSVの読み込み
    fileBuffer
        .pipe(csv({
            mapHeaders: ({ header }) => header.trim().replace(/^"|"$/g, '').replace(/^\uFEFF/, '')
        }))
        .on('data', (data) => {
            if (results.length === 0) {
                console.log('Headers:', Object.keys(data)); // ヘッダー名を出力
            }
            results.push(data);
        })
        .on('end', async () => {
            const updates = results.map(row => ({
                ebay_item_id: row['Item number'], // eBayのアイテムID
                listing_status: 'ACTIVE' // ステータスを「ACTIVE」に設定
            })).filter(update => update.ebay_item_id);

            // Supabaseにバッチ更新
            const batchSize = 100; // バッチサイズ
            for (let i = 0; i < updates.length; i += batchSize) {
                const batch = updates.slice(i, i + batchSize);
                const { error } = await supabase
                    .from('items')
                    .update({ listing_status: 'ACTIVE' })
                    .in('ebay_item_id', batch.map(item => item.ebay_item_id));

                if (error) {
                    console.error(`Error updating batch ${Math.ceil((i + 1) / batchSize)}:`, error.message);
                } else {
                    console.log(`Batch ${Math.ceil((i + 1) / batchSize)} updated successfully.`);
                }
            }

            console.log('CSV processing for active listings completed.');
        });
}

const normalizeHeader = (value) => {
    if (value === undefined || value === null) return '';
    return String(value).trim().toLowerCase();
};

const normalizeTrackingNumber = (value) => {
    if (value === undefined || value === null) return '';
    return String(value).trim();
};

async function updateShippingCostsFromCSV(fileBuffer, userId) {
    const rows = [];

    return new Promise((resolve, reject) => {
        fileBuffer
            .pipe(csv({
                mapHeaders: ({ header }) => header.trim().replace(/^"|"$/g, '').replace(/^\uFEFF/, '')
            }))
            .on('data', (data) => rows.push(data))
            .on('end', async () => {
                try {
                    let updated = 0;
                    let skipped = 0;
                    let failed = 0;

                    for (const row of rows) {
                        const entries = Object.entries(row).reduce((acc, [key, value]) => {
                            acc[normalizeHeader(key)] = value;
                            return acc;
                        }, {});

                        const trackingNumber =
                            normalizeTrackingNumber(
                                entries['tracking_number'] ||
                                entries['tracking'] ||
                                entries['tracking no'] ||
                                entries['tracking number'] ||
                                entries['trackingnumber']
                            );
                        const carrier =
                            entries['shipping_carrier'] ||
                            entries['carrier'] ||
                            entries['shipping carrier'] ||
                            entries['shipper'] ||
                            null;
                        const costRaw =
                            entries['final_shipping_cost'] ||
                            entries['final shipping cost'] ||
                            entries['shipping_cost'] ||
                            entries['shipping cost'] ||
                            entries['cost'] ||
                            null;

                        if (!trackingNumber || costRaw === null || costRaw === undefined) {
                            skipped += 1;
                            continue;
                        }

                        const numericCost = Number(String(costRaw).replace(/[^0-9.-]/g, ''));
                        if (!Number.isFinite(numericCost)) {
                            skipped += 1;
                            continue;
                        }

                        const { error } = await supabase
                            .from('orders')
                            .update({
                                final_shipping_cost: numericCost,
                                shipping_carrier: carrier ? String(carrier).trim() : null,
                            })
                            .eq('user_id', userId)
                            .eq('shipping_tracking_number', trackingNumber);

                        if (error) {
                            console.error('Failed to update shipping cost:', error.message);
                            failed += 1;
                        } else {
                            updated += 1;
                        }
                    }

                    resolve({ updated, skipped, failed });
                } catch (err) {
                    reject(err);
                }
            })
            .on('error', reject);
    });
}


function normalizeAmount(raw) {
    if (raw === undefined || raw === null) {
        return null;
    }
    const str = String(raw).trim();
    if (!str) {
        return null;
    }
    const normalized = str.replace(/,/g, '').replace(/^\((.*)\)$/, '-$1');
    const value = Number(normalized);
    return Number.isFinite(value) ? value : null;
}

function normalizeDate(raw) {
    if (!raw) {
        return null;
    }
    const str = String(raw).trim();
    if (!str) {
        return null;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
        return str;
    }
    if (/^\d{8}$/.test(str)) {
        return `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`;
    }
    const match = str.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
    if (match) {
        const months = {
            Jan: '01', Feb: '02', Mar: '03', Apr: '04',
            May: '05', Jun: '06', Jul: '07', Aug: '08',
            Sep: '09', Oct: '10', Nov: '11', Dec: '12',
        };
        const month = months[match[2]];
        if (month) {
            return `${match[3]}-${month}-${match[1]}`;
        }
    }
    return str;
}

function normalizeUnit(raw) {
    if (raw === undefined || raw === null) return null;
    const unit = String(raw).trim();
    return unit || null;
}

function parseDhlDimensions(raw) {
    const input = String(raw || '').trim();
    if (!input) {
        return {
            length: null,
            width: null,
            height: null,
            unit: null,
            raw: null,
        };
    }
    const unitMatch = input.match(/[A-Za-z]+$/);
    const unit = unitMatch ? unitMatch[0].toUpperCase() : null;
    const normalized = input
        .replace(/[A-Za-z]+$/g, '')
        .trim()
        .replace(/[xX＊*]/g, 'x');
    const parts = normalized
        .split('x')
        .map((v) => normalizeAmount(v))
        .filter((v) => v !== null);
    return {
        length: parts[0] ?? null,
        width: parts[1] ?? null,
        height: parts[2] ?? null,
        unit,
        raw: input,
    };
}

function classifyFedexCharge(label) {
    if (!label) {
        return 'other';
    }
    const normalized = String(label).trim();
    const lower = normalized.toLowerCase();

    // Explicit mapping based on observed FedEx invoice labels.
    const exactShippingLabels = new Set([
        '運送料金',
        '割引額',
        '燃料割増金',
        'Demand Surcharge',
        '個人宅向け配達料',
        '区分A地域外配達料',
        '区分B地域外配達料',
        '配達先訂正料',
        '特別取扱料金 - 寸法',
        '特別取扱料金 - 梱包',
        '特別取扱料金 - 重量',
        '従価料金',
        '第三者請求',
        '混雑時割増金',
    ]);
    const exactCustomsLabels = new Set([
        '関税など',
        'その他税金',
        'カナダハーモナイズドセールス税',
        'MEXICO IVA Freight',
        '商業貨物税関使用料',
        '保税貨物保管料',
    ]);
    const exactDutyFeeLabels = new Set([
        '米国輸入手続き手数料',
    ]);

    if (exactShippingLabels.has(normalized)) {
        return 'shipping';
    }
    if (exactCustomsLabels.has(normalized)) {
        return 'customs';
    }
    if (exactDutyFeeLabels.has(normalized)) {
        return 'fee';
    }

    // Fallback heuristics for unknown future labels.
    if (lower.includes('discount') || lower.includes('割引')) {
        return 'shipping';
    }
    if (
        lower.includes('surcharge') ||
        lower.includes('割増') ||
        lower.includes('配達料') ||
        lower.includes('運送料金') ||
        lower.includes('transportation') ||
        lower.includes('freight')
    ) {
        return 'shipping';
    }
    if (lower.includes('duty') || lower.includes('関税') || lower.includes('税関')) {
        return 'customs';
    }
    if (
        (lower.includes('手数料') || lower.includes('fee')) &&
        (lower.includes('輸入') || lower.includes('通関') || lower.includes('customs'))
    ) {
        return 'fee';
    }
    if (lower.includes('vat') || lower.includes('消費税') || lower.includes('税')) {
        return 'customs';
    }
    return 'other';
}

function classifyDhlCharge(label, taxCode) {
    if (!label && !taxCode) {
        return 'other';
    }
    const lower = String(label || '').toLowerCase();
    const taxLower = String(taxCode || '').toLowerCase();
    // DHL shipping surcharges that should be treated as shipping, not fee/other.
    if (lower.includes('oversize piece') || lower.includes('fuel surcharge')) {
        return 'shipping';
    }
    if (
        taxLower.includes('vat') ||
        taxLower.includes('duty') ||
        lower.includes('duty') ||
        lower.includes('duties') ||
        lower.includes('customs')
    ) {
        return 'customs';
    }
    if (taxLower.includes('vat') || lower.includes('vat')) {
        return 'fee_tax';
    }
    if (lower.includes('tax')) {
        return 'customs';
    }
    if (lower.includes('invoice fee') || lower.includes('other charges') || lower.includes('fee') || lower.includes('surcharge')) {
        return 'fee';
    }
    if (lower.includes('weight') || lower.includes('discount')) {
        return 'shipping';
    }
    return 'other';
}

function getDhlTotalAmountRaw(row) {
    if (!row) return null;
    return (
        row['Total amount (incl. VAT)'] ??
        row['Total amount (excl. VAT)'] ??
        row['Total Amount (incl. VAT)'] ??
        row['Total Amount (excl. VAT)'] ??
        row['Total amount'] ??
        null
    );
}

function normalizeChargeLabel(label) {
    return String(label || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

async function loadChargeLabelCatalogMap(carrier) {
    const result = {};
    const normalizedCarrier = String(carrier || '').toUpperCase();
    if (!normalizedCarrier) return result;
    const { data, error } = await supabase
        .from('carrier_charge_label_catalog')
        .select('id, carrier, normalized_label, default_group, is_active')
        .eq('carrier', normalizedCarrier)
        .eq('is_active', true);
    if (error) {
        console.warn('[carrier-invoice] failed to load charge label catalog:', error.message);
        return result;
    }
    (data || []).forEach((row) => {
        if (!row?.normalized_label) return;
        result[row.normalized_label] = row;
    });
    return result;
}

async function upsertUnknownChargeEvents(events) {
    if (!Array.isArray(events) || events.length === 0) return;
    const nowIso = new Date().toISOString();
    const payload = events.map((row) => ({
        shipment_id: row.shipment_id,
        invoice_id: row.invoice_id,
        carrier: row.carrier,
        invoice_number: row.invoice_number,
        awb_number: row.awb_number,
        charge_name_raw: row.charge_name_raw,
        normalized_label: row.normalized_label,
        amount: row.amount,
        header_occurrence_no: row.header_occurrence_no ?? null,
        line_no: row.line_no ?? null,
        resolved: false,
        resolved_at: null,
        last_detected_at: nowIso,
        updated_at: nowIso,
    }));
    const { error } = await supabase
        .from('carrier_unknown_charge_events')
        .upsert(payload, { onConflict: 'shipment_id,normalized_label,line_no' });
    if (error) {
        console.warn('[carrier-invoice] failed to upsert unknown charge events:', error.message);
    }
}

async function upsertCarrierInvoice(payload) {
    const { data, error } = await supabase
        .from('carrier_invoices')
        .upsert(payload, { onConflict: 'carrier,invoice_number' })
        .select('id')
        .maybeSingle();
    if (error) {
        throw new Error(`carrier_invoices upsert failed: ${error.message}`);
    }
    return data?.id;
}

async function upsertCarrierShipment(payload) {
    const { data, error } = await supabase
        .from('carrier_shipments')
        .upsert(payload, { onConflict: 'invoice_id,awb_number' })
        .select('id')
        .maybeSingle();
    if (error) {
        throw new Error(`carrier_shipments upsert failed: ${error.message}`);
    }
    return data?.id;
}

async function replaceCarrierCharges(shipmentId, charges) {
    const { error: deleteError } = await supabase
        .from('carrier_charges')
        .delete()
        .eq('shipment_id', shipmentId);
    if (deleteError) {
        throw new Error(`carrier_charges delete failed: ${deleteError.message}`);
    }
    if (!charges.length) {
        return;
    }
    const { error: insertError } = await supabase
        .from('carrier_charges')
        .insert(charges);
    if (insertError) {
        throw new Error(`carrier_charges insert failed: ${insertError.message}`);
    }
}

async function insertCarrierInvoiceImportLogs(logs) {
    if (!Array.isArray(logs) || logs.length === 0) {
        return;
    }
    const { error } = await supabase
        .from('carrier_invoice_import_logs')
        .insert(logs);
    if (error) {
        console.error('[carrier-invoice] failed to insert import logs:', error.message);
    }
}

function createChargeSummary() {
    return {
        total_count: 0,
        total_amount: 0,
        shipping_count: 0,
        shipping_amount: 0,
        customs_count: 0,
        customs_amount: 0,
        fee_count: 0,
        fee_amount: 0,
        fee_tax_count: 0,
        fee_tax_amount: 0,
        fee_amount_incl_tax: 0,
        other_count: 0,
        other_amount: 0,
    };
}

function addChargeToSummary(summary, chargeGroup, amount) {
    summary.total_count += 1;
    summary.total_amount += amount;
    if (chargeGroup === 'shipping') {
        summary.shipping_count += 1;
        summary.shipping_amount += amount;
        return;
    }
    if (chargeGroup === 'customs') {
        summary.customs_count += 1;
        summary.customs_amount += amount;
        return;
    }
    if (chargeGroup === 'fee') {
        summary.fee_count += 1;
        summary.fee_amount += amount;
        summary.fee_amount_incl_tax += amount;
        return;
    }
    if (chargeGroup === 'fee_tax') {
        summary.fee_tax_count += 1;
        summary.fee_tax_amount += amount;
        summary.fee_amount_incl_tax += amount;
        return;
    }
    summary.other_count += 1;
    summary.other_amount += amount;
}

function summarizeCharges(charges) {
    const summary = createChargeSummary();
    (charges || []).forEach((charge) => {
        if (charge?.amount === undefined || charge?.amount === null) {
            return;
        }
        addChargeToSummary(summary, charge.charge_group, Number(charge.amount) || 0);
    });
    return summary;
}

function mergeChargeSummary(base, extra) {
    const merged = createChargeSummary();
    const keys = Object.keys(merged);
    keys.forEach((key) => {
        merged[key] = Number(base?.[key] || 0) + Number(extra?.[key] || 0);
    });
    return merged;
}

function mergeChargeDetails(base, extra) {
    const left = Array.isArray(base) ? base : [];
    const right = Array.isArray(extra) ? extra : [];
    return [...left, ...right];
}

async function buildTrackingMatchSummary(awbSet) {
    const awbNumbers = Array.from(awbSet).filter(Boolean);
    if (awbNumbers.length === 0) {
        return {
            total_awb: 0,
            matched_awb: 0,
            unmatched_awb: 0,
            unmatched_samples: [],
        };
    }

    const matched = new Set();
    const chunkSize = 500;
    for (let i = 0; i < awbNumbers.length; i += chunkSize) {
        const chunk = awbNumbers.slice(i, i + chunkSize);
        const { data, error } = await supabase
            .from('orders')
            .select('shipping_tracking_number')
            .in('shipping_tracking_number', chunk);
        if (error) {
            console.error('[carrier-invoice] failed to build tracking match summary:', error.message);
            return {
                total_awb: awbNumbers.length,
                matched_awb: null,
                unmatched_awb: null,
                unmatched_samples: [],
                match_error: error.message,
            };
        }
        (data || []).forEach((row) => {
            const value = row?.shipping_tracking_number;
            if (value) {
                matched.add(value);
            }
        });
    }

    const unmatched = awbNumbers.filter((awb) => !matched.has(awb));
    return {
        total_awb: awbNumbers.length,
        matched_awb: matched.size,
        unmatched_awb: unmatched.length,
        unmatched_samples: unmatched.slice(0, 20),
    };
}

async function loadOrderInfoByTrackingNumbers(awbNumbers) {
    const result = {};
    if (!Array.isArray(awbNumbers) || awbNumbers.length === 0) {
        return result;
    }
    const orderRows = [];
    const chunkSize = 500;
    for (let i = 0; i < awbNumbers.length; i += chunkSize) {
        const chunk = awbNumbers.slice(i, i + chunkSize);
        const { data, error } = await supabase
            .from('orders')
            .select('id, order_no, ebay_user_id, user_id, shipping_tracking_number, buyer_country_code, total_amount, total_amount_currency')
            .in('shipping_tracking_number', chunk);
        if (error) {
            console.error('[carrier-invoice] failed to load orders by tracking:', error.message);
            continue;
        }
        orderRows.push(...(data || []));
    }

    const userIds = Array.from(new Set(orderRows.map((row) => row?.user_id).filter(Boolean)));
    const userRates = {};
    if (userIds.length > 0) {
        const { data: users, error: usersError } = await supabase
            .from('users')
            .select('id, usd_rate, eur_rate, cad_rate, gbp_rate, aud_rate')
            .in('id', userIds);
        if (usersError) {
            console.warn('[carrier-invoice] failed to load users for exchange rates:', usersError.message);
        } else {
            (users || []).forEach((user) => {
                userRates[user.id] = {
                    ...ENV_EXCHANGE_RATES,
                    USD: Number(user.usd_rate) || ENV_EXCHANGE_RATES.USD,
                    EUR: Number(user.eur_rate) || ENV_EXCHANGE_RATES.EUR,
                    CAD: Number(user.cad_rate) || ENV_EXCHANGE_RATES.CAD,
                    GBP: Number(user.gbp_rate) || ENV_EXCHANGE_RATES.GBP,
                    AUD: Number(user.aud_rate) || ENV_EXCHANGE_RATES.AUD,
                    JPY: 1,
                };
            });
        }
    }

    orderRows.forEach((row) => {
        if (!row?.shipping_tracking_number) {
            return;
        }
        const amount = Number(row.total_amount);
        const currency = String(row.total_amount_currency || '').toUpperCase();
        const rates = userRates[row.user_id] || ENV_EXCHANGE_RATES;
        const rate = rates[currency];
        const orderTotalJpy =
            Number.isFinite(amount) && amount > 0 && Number.isFinite(rate) && rate > 0
                ? amount * rate
                : null;
        const normalized = {
            ...row,
            order_total_jpy: orderTotalJpy,
        };
        if (!result[row.shipping_tracking_number]) {
            result[row.shipping_tracking_number] = normalized;
        }
    });
    return result;
}

async function markOrdersReconciledByShipments(shipmentSummaries) {
    const summaries = Array.isArray(shipmentSummaries) ? shipmentSummaries : [];
    const awbToFlags = summaries.reduce((acc, shipment) => {
        const awb = shipment?.awb_number;
        if (!awb) {
            return acc;
        }
        const chargeSummary = shipment?.charge_summary || {};
        const hasShippingCharge =
            Number(chargeSummary.shipping_amount || 0) !== 0 ||
            Number(chargeSummary.other_amount || 0) !== 0 ||
            Number(chargeSummary.fee_amount || 0) !== 0 ||
            Number(chargeSummary.fee_tax_amount || 0) !== 0;
        const hasCustomsCharge = Number(chargeSummary.customs_amount || 0) !== 0;
        if (!acc[awb]) {
            acc[awb] = { shipping: false, duty: false };
        }
        if (hasShippingCharge) {
            acc[awb].shipping = true;
        }
        if (hasCustomsCharge) {
            acc[awb].duty = true;
        }
        return acc;
    }, {});

    const entries = Object.entries(awbToFlags);
    if (entries.length === 0) {
        return { updated_shipping: 0, updated_duty: 0 };
    }

    let updatedShipping = 0;
    let updatedDuty = 0;
    const nowIso = new Date().toISOString();

    for (const [awb, flags] of entries) {
        const updatePayload = {};
        if (flags.shipping) {
            updatePayload.shipping_reconciled_at = nowIso;
        }
        if (flags.duty) {
            updatePayload.duty_reconciled_at = nowIso;
        }
        if (Object.keys(updatePayload).length === 0) {
            continue;
        }
        const { data, error } = await supabase
            .from('orders')
            .update(updatePayload)
            .eq('shipping_tracking_number', awb)
            .select('id');
        if (error) {
            console.error('[carrier-invoice] failed to mark order reconciled:', error.message, { awb });
            continue;
        }
        const affected = Array.isArray(data) ? data.length : 0;
        if (flags.shipping) {
            updatedShipping += affected;
        }
        if (flags.duty) {
            updatedDuty += affected;
        }
    }

    return { updated_shipping: updatedShipping, updated_duty: updatedDuty };
}

function buildShipmentAnomalies(shipment, orderInfo) {
    const anomalies = [];
    const customsRatioThreshold = DEFAULT_CUSTOMS_RATIO_THRESHOLD;
    const feeRatioThreshold = DEFAULT_FEE_RATIO_THRESHOLD;
    const minFeeAmountForFeeRatio = DEFAULT_FEE_RATIO_MIN_FEE_AMOUNT;
    const minShippingAmountForFeeRatio = DEFAULT_FEE_RATIO_MIN_SHIPPING_AMOUNT;
    const shippingAmount = Number(shipment?.charge_summary?.shipping_amount) || 0;
    const customsAmount = Number(shipment?.charge_summary?.customs_amount) || 0;
    const feeAmount = Number(shipment?.charge_summary?.fee_amount) || 0;
    const buyerCountryCode = orderInfo?.buyer_country_code || null;

    if (!orderInfo) {
        anomalies.push({
            anomaly_code: 'UNMATCHED_AWB',
            severity: 'warning',
            message: 'Tracking number did not match any order',
        });
    }

    if (customsAmount > 0 && buyerCountryCode && buyerCountryCode !== 'US') {
        anomalies.push({
            anomaly_code: 'CUSTOMS_NON_US',
            severity: 'high',
            message: `Customs amount exists for non-US destination (${buyerCountryCode})`,
        });
    }

    if (
        shippingAmount >= minShippingAmountForFeeRatio &&
        feeAmount >= minFeeAmountForFeeRatio &&
        feeAmount / shippingAmount > feeRatioThreshold
    ) {
        anomalies.push({
            anomaly_code: 'HIGH_FEE_RATIO',
            severity: 'warning',
            message: `Fee ratio is high (${(feeAmount / shippingAmount * 100).toFixed(1)}%; fee=${feeAmount}, shipping=${shippingAmount})`,
        });
    }

    const orderTotalJpy = Number(orderInfo?.order_total_jpy || 0);
    if (customsAmount > 0 && orderTotalJpy > 0 && customsAmount / orderTotalJpy > customsRatioThreshold) {
        anomalies.push({
            anomaly_code: 'HIGH_CUSTOMS_RATIO',
            severity: 'medium',
            message: `Customs ratio is high (${(customsAmount / orderTotalJpy * 100).toFixed(1)}% of order amount)`,
        });
    }

    const unknownOtherCharges = (shipment.charge_details || []).filter((row) => {
        const group = String(row?.charge_group || '').toLowerCase();
        if (group !== 'other') return false;
        const amount = Number(row?.amount || 0);
        if (Math.abs(amount) < DEFAULT_UNKNOWN_OTHER_MIN_ABS_AMOUNT) return false;
        const label = String(row?.charge_name_raw || '').toLowerCase();
        if (!label) return true;
        return !DEFAULT_OTHER_LABEL_ALLOWLIST.some((allowed) => label.includes(allowed));
    });
    if (unknownOtherCharges.length > 0) {
        anomalies.push({
            anomaly_code: 'UNKNOWN_OTHER_CHARGE',
            severity: 'medium',
            message: `Unknown other charge labels detected: ${unknownOtherCharges
                .slice(0, 3)
                .map((row) => row.charge_name_raw)
                .join(', ')}`,
        });
    }

    return anomalies;
}

async function upsertCarrierInvoiceAnomalies(anomalies) {
    if (!Array.isArray(anomalies) || anomalies.length === 0) {
        return { ok: true, error: null };
    }
    const nowIso = new Date().toISOString();
    const shipmentIds = Array.from(new Set(anomalies.map((row) => row.shipment_id).filter(Boolean)));
    const anomalyCodes = Array.from(new Set(anomalies.map((row) => row.anomaly_code).filter(Boolean)));

    let existingRows = [];
    if (shipmentIds.length > 0 && anomalyCodes.length > 0) {
        const { data, error } = await supabase
            .from('carrier_invoice_anomalies')
            .select('shipment_id, anomaly_code, resolved, resolved_at, resolved_reason, resolved_by, resolved_note')
            .in('shipment_id', shipmentIds)
            .in('anomaly_code', anomalyCodes);
        if (error) {
            console.error('[carrier-invoice] failed to load existing anomalies before upsert:', error.message);
            return { ok: false, error: error.message };
        }
        existingRows = data || [];
    }

    const existingByKey = new Map(
        existingRows.map((row) => [`${row.shipment_id}::${row.anomaly_code}`, row])
    );

    const payload = anomalies.map((row) => {
        const existing = existingByKey.get(`${row.shipment_id}::${row.anomaly_code}`) || null;
        const keepResolved = !!existing?.resolved;
        return {
        shipment_id: row.shipment_id,
        invoice_id: row.invoice_id,
        carrier: row.carrier,
        invoice_number: row.invoice_number,
        awb_number: row.awb_number,
        order_id: row.order_id,
        order_no: row.order_no,
        ebay_user_id: row.ebay_user_id,
        buyer_country_code: row.buyer_country_code,
        anomaly_code: row.anomaly_code,
        severity: row.severity,
        message: row.message,
        shipping_amount: row.shipping_amount,
        customs_amount: row.customs_amount,
        fee_amount: row.fee_amount,
        fee_tax_amount: row.fee_tax_amount,
        fee_amount_incl_tax: row.fee_amount_incl_tax,
        total_amount: row.total_amount,
        details: row.details,
        last_detected_at: nowIso,
        // Preserve manual/system resolution once checked.
        resolved: keepResolved,
        resolved_at: keepResolved ? existing.resolved_at || nowIso : null,
        resolved_reason: keepResolved ? existing.resolved_reason || null : null,
        resolved_by: keepResolved ? existing.resolved_by || null : null,
        resolved_note: keepResolved ? existing.resolved_note || null : null,
    };});
    const { error } = await supabase
        .from('carrier_invoice_anomalies')
        .upsert(payload, { onConflict: 'shipment_id,anomaly_code' });
    if (error) {
        console.error('[carrier-invoice] failed to upsert anomalies:', error.message);
        return { ok: false, error: error.message };
    }
    return { ok: true, error: null };
}

async function detectAndPersistCarrierAnomalies(shipments) {
    const dedupedByShipment = new Map();
    (shipments || []).forEach((row) => {
        if (!row?.shipment_id) {
            return;
        }
        const existing = dedupedByShipment.get(row.shipment_id);
        if (!existing) {
            dedupedByShipment.set(row.shipment_id, row);
            return;
        }
        dedupedByShipment.set(row.shipment_id, {
            ...existing,
            charge_summary: mergeChargeSummary(existing.charge_summary, row.charge_summary),
            charge_details: mergeChargeDetails(existing.charge_details, row.charge_details),
        });
    });
    const dedupedShipments = Array.from(dedupedByShipment.values());

    const awbNumbers = Array.from(
        new Set((dedupedShipments || []).map((row) => row.awb_number).filter(Boolean))
    );
    const orderInfoByTracking = await loadOrderInfoByTrackingNumbers(awbNumbers);
    const anomalies = [];

    (dedupedShipments || []).forEach((shipment) => {
        const orderInfo = shipment.awb_number ? orderInfoByTracking[shipment.awb_number] : null;
        const shipmentAnomalies = buildShipmentAnomalies(shipment, orderInfo);
        shipmentAnomalies.forEach((anomaly) => {
            anomalies.push({
                shipment_id: shipment.shipment_id,
                invoice_id: shipment.invoice_id,
                carrier: shipment.carrier,
                invoice_number: shipment.invoice_number,
                awb_number: shipment.awb_number,
                order_id: orderInfo?.id || null,
                order_no: orderInfo?.order_no || null,
                ebay_user_id: orderInfo?.ebay_user_id || null,
                buyer_country_code: orderInfo?.buyer_country_code || null,
                anomaly_code: anomaly.anomaly_code,
                severity: anomaly.severity,
                message: anomaly.message,
                shipping_amount: shipment.charge_summary.shipping_amount,
                customs_amount: shipment.charge_summary.customs_amount,
                fee_amount: shipment.charge_summary.fee_amount,
                fee_tax_amount: shipment.charge_summary.fee_tax_amount,
                fee_amount_incl_tax: shipment.charge_summary.fee_amount_incl_tax,
                total_amount: shipment.charge_summary.total_amount,
                details: {
                    charge_summary: shipment.charge_summary,
                },
            });
        });
    });

    const persistResult = await upsertCarrierInvoiceAnomalies(anomalies);
    const bySeverity = anomalies.reduce((acc, row) => {
        const key = row.severity || 'unknown';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});
    return {
        count: anomalies.length,
        by_severity: bySeverity,
        samples: anomalies.slice(0, 20),
        persist_error: persistResult?.ok ? null : persistResult?.error || 'failed to persist anomalies',
    };
}

async function processFedexRows(rows, sourceFileName, options = {}) {
    const importRunId = options.importRunId || randomUUID();
    const labelHeaderCount = Number(options.labelHeaderCount || 0);
    const amountHeaderCount = Number(options.amountHeaderCount || 0);
    if (labelHeaderCount !== amountHeaderCount) {
        await insertCarrierInvoiceImportLogs([
            {
                carrier: 'FEDEX',
                source_file_name: sourceFileName,
                import_run_id: importRunId,
                severity: 'error',
                message: `FedEx duplicated header count mismatch: label=${labelHeaderCount}, amount=${amountHeaderCount}`,
                context: { labelHeaderCount, amountHeaderCount },
            },
        ]);
        throw new Error(`FedEx duplicated header count mismatch: label=${labelHeaderCount}, amount=${amountHeaderCount}`);
    }

    let processed = 0;
    let skippedMissingRequired = 0;
    const awbSet = new Set();
    const chargeSummary = createChargeSummary();
    const shipmentSummaries = [];
    const importLogs = [];
    let totalDetectedChargePairs = 0;
    let mismatchPairRows = 0;
    let warningCount = 0;
    const unknownChargeEvents = [];
    const fedexCatalog = await loadChargeLabelCatalogMap('FEDEX');

    for (const row of rows) {
        const invoiceNumber = row['FedEx請求書番号'];
        const awb = row['航空貨物運送状番号'];
        if (!invoiceNumber || !awb) {
            skippedMissingRequired += 1;
            continue;
        }
        awbSet.add(awb);
        const invoiceId = await upsertCarrierInvoice({
            carrier: 'FEDEX',
            invoice_number: invoiceNumber,
            invoice_date: normalizeDate(row['請求書発行日']),
            currency: row['請求通貨'] || null,
            billing_account: row['請求先アカウント・ナンバー'] || null,
            source_file_name: sourceFileName,
        });
        const shipmentId = await upsertCarrierShipment({
            invoice_id: invoiceId,
            awb_number: awb,
            shipment_date: normalizeDate(row['出荷日'] || row['出荷日（書式設定済）']),
            reference_1: row['荷送人参照1'] || null,
            shipment_total: normalizeAmount(row['航空貨物運送状の総額']),
            carrier_actual_weight: normalizeAmount(row['実重量']),
            carrier_actual_weight_unit: normalizeUnit(row['実重量単位']),
            carrier_billed_weight: normalizeAmount(row['請求重量']),
            carrier_billed_weight_unit: normalizeUnit(row['請求重量単位']),
            carrier_dim_length: normalizeAmount(row['Dim長さ']),
            carrier_dim_width: normalizeAmount(row['Dim幅']),
            carrier_dim_height: normalizeAmount(row['Dim高さ']),
            carrier_dim_unit: normalizeUnit(row['Dim単位']),
        });

        const labelMap = {};
        const amountMap = {};
        Object.entries(row).forEach(([key, value]) => {
            const labelMatch = key.match(/^航空貨物運送状の請求ラベル__(\d+)$/);
            if (labelMatch) {
                labelMap[Number(labelMatch[1])] = value;
            }
            const amountMatch = key.match(/^航空貨物運送状の請求額__(\d+)$/);
            if (amountMatch) {
                amountMap[Number(amountMatch[1])] = value;
            }
        });
        const labelIndices = Object.keys(labelMap)
            .map(Number)
            .sort((a, b) => a - b);
        const amountIndices = Object.keys(amountMap)
            .map(Number)
            .sort((a, b) => a - b);
        totalDetectedChargePairs += Math.max(labelIndices.length, amountIndices.length);

        if (labelIndices.length !== amountIndices.length) {
            mismatchPairRows += 1;
            warningCount += 1;
            importLogs.push({
                carrier: 'FEDEX',
                source_file_name: sourceFileName,
                import_run_id: importRunId,
                invoice_number: invoiceNumber,
                awb_number: awb,
                severity: 'warning',
                message: `label/amount occurrence mismatch in row: label=${labelIndices.length}, amount=${amountIndices.length}`,
                context: {
                    labelIndices,
                    amountIndices,
                },
            });
        }

        const charges = [];
        const pairCount = Math.max(labelIndices.length, amountIndices.length);
        for (let idx = 0; idx < pairCount; idx += 1) {
            const occurrenceNo = idx + 1;
            const labelIndex = labelIndices[idx];
            const amountIndex = amountIndices[idx];
            const label = labelIndex !== undefined ? labelMap[labelIndex] : null;
            const amountRaw = amountIndex !== undefined ? amountMap[amountIndex] : null;
            const amount = normalizeAmount(amountRaw);
            const hasLabel = label !== undefined && label !== null && String(label).trim() !== '';
            const hasAmountRaw = amountRaw !== undefined && amountRaw !== null && String(amountRaw).trim() !== '';

            if (!hasLabel && !hasAmountRaw) {
                continue;
            }
            if (!hasLabel || !hasAmountRaw || amount === null) {
                warningCount += 1;
                importLogs.push({
                    carrier: 'FEDEX',
                    source_file_name: sourceFileName,
                    import_run_id: importRunId,
                    invoice_number: invoiceNumber,
                    awb_number: awb,
                    row_no: processed + skippedMissingRequired + 1,
                    header_occurrence_no: occurrenceNo,
                    charge_name_raw: hasLabel ? String(label) : null,
                    raw_amount: hasAmountRaw ? String(amountRaw) : null,
                    severity: 'warning',
                    message: 'Invalid or incomplete duplicated FedEx charge pair',
                    context: {
                        labelIndex,
                        amountIndex,
                        parsedAmount: amount,
                    },
                });
                continue;
            }
            if (amount === 0) {
                continue;
            }
            const normalizedLabel = normalizeChargeLabel(String(label));
            const catalogEntry = fedexCatalog[normalizedLabel] || null;
            const chargeGroup =
                catalogEntry?.default_group && catalogEntry.default_group !== 'ignore'
                    ? catalogEntry.default_group
                    : classifyFedexCharge(String(label));
            charges.push({
                shipment_id: shipmentId,
                charge_group: chargeGroup,
                charge_name_raw: String(label),
                amount,
                invoice_category: row['請求書の種類'] || null,
                header_occurrence_no: occurrenceNo,
                line_no: occurrenceNo,
            });
            addChargeToSummary(chargeSummary, chargeGroup, amount);
            if (!catalogEntry && chargeGroup === 'other') {
                const lowerLabel = normalizedLabel;
                if (
                    Math.abs(amount) >= DEFAULT_UNKNOWN_OTHER_MIN_ABS_AMOUNT &&
                    !DEFAULT_OTHER_LABEL_ALLOWLIST.some((allowed) => lowerLabel.includes(allowed))
                ) {
                    unknownChargeEvents.push({
                        shipment_id: shipmentId,
                        invoice_id: invoiceId,
                        carrier: 'FEDEX',
                        invoice_number: invoiceNumber,
                        awb_number: awb,
                        charge_name_raw: String(label),
                        normalized_label: normalizedLabel,
                        amount,
                        header_occurrence_no: occurrenceNo,
                        line_no: occurrenceNo,
                    });
                }
            }
        }
        await replaceCarrierCharges(shipmentId, charges);
        shipmentSummaries.push({
            shipment_id: shipmentId,
            invoice_id: invoiceId,
            carrier: 'FEDEX',
            invoice_number: invoiceNumber,
            awb_number: awb,
            charge_summary: summarizeCharges(charges),
            charge_details: charges.map((charge) => ({
                charge_group: charge.charge_group,
                charge_name_raw: charge.charge_name_raw,
                amount: charge.amount,
            })),
        });
        processed += 1;
    }
    await insertCarrierInvoiceImportLogs(importLogs);
    await upsertUnknownChargeEvents(unknownChargeEvents);
    const trackingMatch = await buildTrackingMatchSummary(awbSet);
    const reconciledSummary = await markOrdersReconciledByShipments(shipmentSummaries);
    const anomalySummary = await detectAndPersistCarrierAnomalies(shipmentSummaries);
    const result = {
        carrier: 'FEDEX',
        source_file_name: sourceFileName,
        import_run_id: importRunId,
        total_rows: rows.length,
        processed_shipments: processed,
        skipped_rows_missing_required: skippedMissingRequired,
        fedex_charge_pairs: {
            detected_pairs: totalDetectedChargePairs,
            rows_with_pair_mismatch: mismatchPairRows,
        },
        import_log_summary: {
            total_warnings: warningCount,
        },
        charge_summary: chargeSummary,
        tracking_match: trackingMatch,
        reconciled_orders: reconciledSummary,
        anomalies: anomalySummary,
    };
    console.log('[carrier-invoice] import summary:', JSON.stringify(result));
    return result;
}

async function processDhlRows(rows, sourceFileName) {
    let processed = 0;
    let skippedMissingRequired = 0;
    const grouped = new Map();
    const awbSet = new Set();
    const chargeSummary = createChargeSummary();
    const shipmentSummaries = [];
    const unknownChargeEvents = [];
    const dhlCatalog = await loadChargeLabelCatalogMap('DHL');
    rows.forEach((row) => {
        const invoiceNumber = row['Invoice Number'];
        const awb = row['Shipment Number'];
        if (!invoiceNumber || !awb) {
            skippedMissingRequired += 1;
            return;
        }
        awbSet.add(awb);
        const key = `${invoiceNumber}::${awb}`;
        if (!grouped.has(key)) {
            grouped.set(key, []);
        }
        grouped.get(key).push(row);
    });

    for (const [key, groupRows] of grouped.entries()) {
        const [invoiceNumber, awb] = key.split('::');
        const firstRow = groupRows[0];
        const invoiceId = await upsertCarrierInvoice({
            carrier: 'DHL',
            invoice_number: invoiceNumber,
            invoice_date: normalizeDate(firstRow['Invoice Date']),
            currency: firstRow['Currency'] || null,
            billing_account: firstRow['Billing Account'] || null,
            source_file_name: sourceFileName,
        });
        const dhlDimensions = parseDhlDimensions(firstRow['Dimensions']);
        const shipmentId = await upsertCarrierShipment({
            invoice_id: invoiceId,
            awb_number: awb,
            shipment_date: normalizeDate(firstRow['Shipment Date']),
            reference_1: firstRow['Shipment Reference 1'] || null,
            shipment_total: normalizeAmount(getDhlTotalAmountRaw(firstRow)),
            carrier_actual_weight: normalizeAmount(firstRow['DHL Scale Weight (B)']) ?? normalizeAmount(firstRow['Cust Scale Weight (A)']),
            carrier_actual_weight_unit: 'KG',
            carrier_billed_weight: normalizeAmount(firstRow['Weight (kg)']) ?? normalizeAmount(firstRow['DHL Vol Weight (W)']),
            carrier_billed_weight_unit: 'KG',
            carrier_dim_length: dhlDimensions.length,
            carrier_dim_width: dhlDimensions.width,
            carrier_dim_height: dhlDimensions.height,
            carrier_dim_unit: dhlDimensions.unit,
            carrier_weight_flag: firstRow['Weight Flag'] || null,
            carrier_dimensions_raw: dhlDimensions.raw,
        });

        const charges = [];
        let lineNo = 1;
        const pushCharge = (name, amount, code = null, taxCode = null) => {
            const parsed = normalizeAmount(amount);
            if (parsed === null || parsed === 0) {
                return;
            }
            const normalizedLabel = normalizeChargeLabel(name);
            const catalogEntry = dhlCatalog[normalizedLabel] || null;
            const chargeGroup =
                catalogEntry?.default_group && catalogEntry.default_group !== 'ignore'
                    ? catalogEntry.default_group
                    : classifyDhlCharge(name, taxCode);
            charges.push({
                shipment_id: shipmentId,
                charge_group: chargeGroup,
                charge_name_raw: name,
                amount: parsed,
                charge_code: code,
                line_no: lineNo,
            });
            addChargeToSummary(chargeSummary, chargeGroup, parsed);
            if (!catalogEntry && chargeGroup === 'other') {
                const lowerLabel = normalizedLabel;
                if (
                    Math.abs(parsed) >= DEFAULT_UNKNOWN_OTHER_MIN_ABS_AMOUNT &&
                    !DEFAULT_OTHER_LABEL_ALLOWLIST.some((allowed) => lowerLabel.includes(allowed))
                ) {
                    unknownChargeEvents.push({
                        shipment_id: shipmentId,
                        invoice_id: invoiceId,
                        carrier: 'DHL',
                        invoice_number: invoiceNumber,
                        awb_number: awb,
                        charge_name_raw: name,
                        normalized_label: normalizedLabel,
                        amount: parsed,
                        header_occurrence_no: null,
                        line_no: lineNo,
                    });
                }
            }
            lineNo += 1;
        };

        groupRows.forEach((row) => {
            const product = String(row['Product'] || '').toLowerCase();
            if (product.includes('duties') || product.includes('tax')) {
                pushCharge(row['Product Name'] || 'DUTIES & TAXES', getDhlTotalAmountRaw(row), row['Product'], row['Tax Code']);
            }
            pushCharge('Weight Charge', row['Weight Charge'], null, row['Tax Code']);
            pushCharge('Invoice Fee', row['Invoice Fee'], null, row['Tax Code']);
            pushCharge(row['Other Charges 1'] || 'Other Charges 1', row['Other Charges 1 Amount']);
            pushCharge(row['Other Charges 2'] || 'Other Charges 2', row['Other Charges 2 Amount']);
            pushCharge(row['Discount 1'] || 'Discount 1', row['Discount 1 Amount']);
            pushCharge(row['Discount 2'] || 'Discount 2', row['Discount 2 Amount']);
            pushCharge(row['Discount 3'] || 'Discount 3', row['Discount 3 Amount']);

            for (let i = 1; i <= 9; i += 1) {
                const code = row[`XC${i} Code`];
                const name = row[`XC${i} Name`] || `XC${i}`;
                const amount = row[`XC${i} Charge`];
                pushCharge(name, amount, code, row[`XC${i} Tax Code`]);
            }
        });

        await replaceCarrierCharges(shipmentId, charges);
        shipmentSummaries.push({
            shipment_id: shipmentId,
            invoice_id: invoiceId,
            carrier: 'DHL',
            invoice_number: invoiceNumber,
            awb_number: awb,
            charge_summary: summarizeCharges(charges),
            charge_details: charges.map((charge) => ({
                charge_group: charge.charge_group,
                charge_name_raw: charge.charge_name_raw,
                amount: charge.amount,
            })),
        });
        processed += 1;
    }
    const trackingMatch = await buildTrackingMatchSummary(awbSet);
    await upsertUnknownChargeEvents(unknownChargeEvents);
    const reconciledSummary = await markOrdersReconciledByShipments(shipmentSummaries);
    const anomalySummary = await detectAndPersistCarrierAnomalies(shipmentSummaries);
    const result = {
        carrier: 'DHL',
        source_file_name: sourceFileName,
        total_rows: rows.length,
        processed_shipments: processed,
        skipped_rows_missing_required: skippedMissingRequired,
        charge_summary: chargeSummary,
        tracking_match: trackingMatch,
        reconciled_orders: reconciledSummary,
        anomalies: anomalySummary,
    };
    console.log('[carrier-invoice] import summary:', JSON.stringify(result));
    return result;
}

async function updateCarrierInvoicesFromCSV(fileBuffer, sourceFileName) {
    return await new Promise((resolve, reject) => {
        const rows = [];
        const rawHeaders = [];
        fileBuffer
            .pipe(csv({
                mapHeaders: ({ header, index }) => {
                    const trimmed = header.trim();
                    rawHeaders[index] = trimmed;
                    if (trimmed === '航空貨物運送状の請求ラベル' || trimmed === '航空貨物運送状の請求額') {
                        return `${trimmed}__${index}`;
                    }
                    return trimmed;
                }
            }))
            .on('data', (row) => rows.push(row))
            .on('end', async () => {
                try {
                    const isFedex = rawHeaders.includes('FedEx請求書番号');
                    const isDhl = rawHeaders.includes('Invoice Number');
                    if (!isFedex && !isDhl) {
                        throw new Error('Unknown carrier CSV format');
                    }
                    const labelHeaderCount = rawHeaders.filter((h) => h === '航空貨物運送状の請求ラベル').length;
                    const amountHeaderCount = rawHeaders.filter((h) => h === '航空貨物運送状の請求額').length;
                    const importRunId = randomUUID();
                    const result = isFedex
                        ? await processFedexRows(rows, sourceFileName, {
                            importRunId,
                            labelHeaderCount,
                            amountHeaderCount,
                        })
                        : await processDhlRows(rows, sourceFileName);
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            })
            .on('error', (error) => reject(error));
    });
}

async function fetchCarrierInvoiceAnomalies(filters = {}) {
    const limit = Number.isFinite(Number(filters.limit)) ? Math.min(Number(filters.limit), 200) : 50;
    const page = Number.isFinite(Number(filters.page)) ? Math.max(Number(filters.page), 0) : 0;
    const offset = page * limit;
    const {
        carrier,
        severity,
        anomaly_code,
        tracking_number,
        status,
        from_date,
        to_date,
    } = filters;

    let query = supabase
        .from('carrier_invoice_anomalies')
        .select('*', { count: 'exact' })
        .order('last_detected_at', { ascending: false })
        .range(offset, offset + limit - 1);

    if (carrier) query = query.eq('carrier', carrier);
    if (severity) query = query.eq('severity', severity);
    if (anomaly_code) query = query.eq('anomaly_code', anomaly_code);
    if (tracking_number) query = query.ilike('awb_number', `%${tracking_number}%`);
    if (status === 'open') query = query.eq('resolved', false);
    if (status === 'resolved') query = query.eq('resolved', true);
    if (from_date) query = query.gte('last_detected_at', `${from_date}T00:00:00`);
    if (to_date) query = query.lte('last_detected_at', `${to_date}T23:59:59`);

    const { data, error, count } = await query;
    if (error) {
        throw new Error(`failed to fetch carrier invoice anomalies: ${error.message}`);
    }
    return {
        rows: data || [],
        total: count || 0,
    };
}

async function updateCarrierInvoiceAnomalyResolution(id, payload = {}) {
    if (!id) {
        throw new Error('id is required');
    }
    const resolved = payload.resolved === true;
    const updatePayload = {
        resolved,
        resolved_at: resolved ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
    };
    if (payload.resolved_reason !== undefined) {
        updatePayload.resolved_reason = payload.resolved_reason || null;
    }
    if (payload.resolved_by !== undefined) {
        updatePayload.resolved_by = payload.resolved_by || null;
    }
    if (payload.resolved_note !== undefined) {
        updatePayload.resolved_note = payload.resolved_note || null;
    }

    const { data, error } = await supabase
        .from('carrier_invoice_anomalies')
        .update(updatePayload)
        .eq('id', id)
        .select('*')
        .single();
    if (error) {
        throw new Error(`failed to update anomaly resolution: ${error.message}`);
    }
    return data;
}

async function fetchCarrierInvoiceChargeDetails(filters = {}) {
    const carrier = filters.carrier ? String(filters.carrier).trim().toUpperCase() : '';
    const awbNumber = filters.awb_number ? String(filters.awb_number).trim() : '';
    const invoiceNumber = filters.invoice_number ? String(filters.invoice_number).trim() : '';
    if (!awbNumber) {
        throw new Error('awb_number is required');
    }

    const { data: shipments, error: shipmentError } = await runWithRetry(
        async () => supabase
            .from('carrier_shipments')
            .select('id, awb_number, shipment_date, reference_1, shipment_total, invoice_id')
            .eq('awb_number', awbNumber),
        'fetch carrier_shipments by awb'
    );
    if (shipmentError) {
        throw new Error(`failed to fetch carrier shipments: ${shipmentError.message}`);
    }
    if (!shipments || shipments.length === 0) {
        return { shipment: null, charges: [] };
    }

    const invoiceIds = Array.from(new Set(shipments.map((s) => s.invoice_id).filter(Boolean)));
    const { data: invoices, error: invoiceError } = await runWithRetry(
        async () => supabase
            .from('carrier_invoices')
            .select('id, carrier, invoice_number, invoice_date, currency, billing_account, source_file_name')
            .in('id', invoiceIds),
        'fetch carrier_invoices by ids'
    );
    if (invoiceError) {
        throw new Error(`failed to fetch carrier invoices: ${invoiceError.message}`);
    }
    const invoiceById = (invoices || []).reduce((acc, row) => {
        acc[row.id] = row;
        return acc;
    }, {});

    const candidates = shipments
        .map((shipment) => ({
            ...shipment,
            invoice: invoiceById[shipment.invoice_id] || null,
        }))
        .filter((row) => {
            if (carrier && row.invoice?.carrier !== carrier) return false;
            if (invoiceNumber && row.invoice?.invoice_number !== invoiceNumber) return false;
            return true;
        });
    if (candidates.length === 0) {
        return { shipment: null, charges: [] };
    }

    candidates.sort((a, b) => {
        const aDate = a.invoice?.invoice_date || '';
        const bDate = b.invoice?.invoice_date || '';
        if (aDate !== bDate) return aDate < bDate ? 1 : -1;
        const aNo = a.invoice?.invoice_number || '';
        const bNo = b.invoice?.invoice_number || '';
        return aNo < bNo ? 1 : -1;
    });
    const target = candidates[0];

    const { data: charges, error: chargeError } = await runWithRetry(
        async () => supabase
            .from('carrier_charges')
            .select('id, charge_group, charge_name_raw, amount, charge_code, invoice_category, header_occurrence_no, line_no')
            .eq('shipment_id', target.id)
            .order('header_occurrence_no', { ascending: true, nullsFirst: false })
            .order('line_no', { ascending: true, nullsFirst: false }),
        'fetch carrier_charges by shipment_id'
    );
    if (chargeError) {
        throw new Error(`failed to fetch carrier charges: ${chargeError.message}`);
    }

    return {
        shipment: {
            shipment_id: target.id,
            awb_number: target.awb_number,
            shipment_date: target.shipment_date,
            reference_1: target.reference_1,
            shipment_total: target.shipment_total,
            invoice_id: target.invoice_id,
            carrier: target.invoice?.carrier || null,
            invoice_number: target.invoice?.invoice_number || null,
            invoice_date: target.invoice?.invoice_date || null,
            currency: target.invoice?.currency || null,
            billing_account: target.invoice?.billing_account || null,
            source_file_name: target.invoice?.source_file_name || null,
        },
        charges: charges || [],
    };
}

async function fetchUnknownCarrierChargeEvents(filters = {}) {
    const limit = Number.isFinite(Number(filters.limit)) ? Math.min(Number(filters.limit), 200) : 50;
    const page = Number.isFinite(Number(filters.page)) ? Math.max(Number(filters.page), 0) : 0;
    const offset = page * limit;
    let query = supabase
        .from('carrier_unknown_charge_events')
        .select('*', { count: 'exact' })
        .order('last_detected_at', { ascending: false })
        .range(offset, offset + limit - 1);

    if (filters.carrier) query = query.eq('carrier', filters.carrier);
    if (filters.tracking_number) query = query.ilike('awb_number', `%${filters.tracking_number}%`);
    if (filters.label) query = query.ilike('charge_name_raw', `%${filters.label}%`);
    if (filters.status === 'open') query = query.eq('resolved', false);
    if (filters.status === 'resolved') query = query.eq('resolved', true);
    if (filters.from_date) query = query.gte('last_detected_at', `${filters.from_date}T00:00:00`);
    if (filters.to_date) query = query.lte('last_detected_at', `${filters.to_date}T23:59:59`);

    const { data, error, count } = await query;
    if (error) {
        throw new Error(`failed to fetch unknown carrier charge events: ${error.message}`);
    }
    return {
        rows: data || [],
        total: count || 0,
    };
}

module.exports = {
    updateCategoriesFromCSV,
    updateTrafficFromCSV,
    updateActiveListingsCSV,
    updateShippingCostsFromCSV,
    updateCarrierInvoicesFromCSV,
    fetchCarrierInvoiceAnomalies,
    updateCarrierInvoiceAnomalyResolution,
    fetchCarrierInvoiceChargeDetails,
    fetchUnknownCarrierChargeEvents,
};
