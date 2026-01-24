const csv = require('csv-parser');
const supabase = require('../supabaseClient');

const batchSize = 100; // バッチサイズを設定
const concurrencyLimit = 5; // 並行処理のリミットを設定

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

function classifyFedexCharge(label) {
    if (!label) {
        return 'other';
    }
    const lower = String(label).toLowerCase();
    if (lower.includes('運送料金') || lower.includes('transportation') || lower.includes('freight')) {
        return 'shipping';
    }
    if (lower.includes('duty') || lower.includes('税') || lower.includes('関税')) {
        return 'customs';
    }
    if (lower.includes('手数料') || lower.includes('fee') || lower.includes('surcharge')) {
        return 'fee';
    }
    return 'other';
}

function classifyDhlCharge(label, taxCode) {
    if (!label && !taxCode) {
        return 'other';
    }
    const lower = String(label || '').toLowerCase();
    const taxLower = String(taxCode || '').toLowerCase();
    if (taxLower.includes('vat') || taxLower.includes('duty') || lower.includes('duty') || lower.includes('tax')) {
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

async function processFedexRows(rows, sourceFileName) {
    let processed = 0;
    for (const row of rows) {
        const invoiceNumber = row['FedEx請求書番号'];
        const awb = row['航空貨物運送状番号'];
        if (!invoiceNumber || !awb) {
            continue;
        }
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
        const indices = Array.from(new Set([...Object.keys(labelMap), ...Object.keys(amountMap)]))
            .map(Number)
            .sort((a, b) => a - b);
        const charges = [];
        indices.forEach((index, idx) => {
            const label = labelMap[index];
            const amount = normalizeAmount(amountMap[index]);
            if (!label || amount === null || amount === 0) {
                return;
            }
            charges.push({
                shipment_id: shipmentId,
                charge_group: classifyFedexCharge(label),
                charge_name_raw: label,
                amount,
                invoice_category: row['請求書の種類'] || null,
                line_no: idx + 1,
            });
        });
        await replaceCarrierCharges(shipmentId, charges);
        processed += 1;
    }
    return { processed };
}

async function processDhlRows(rows, sourceFileName) {
    let processed = 0;
    const grouped = new Map();
    rows.forEach((row) => {
        const invoiceNumber = row['Invoice Number'];
        const awb = row['Shipment Number'];
        if (!invoiceNumber || !awb) {
            return;
        }
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
        const shipmentId = await upsertCarrierShipment({
            invoice_id: invoiceId,
            awb_number: awb,
            shipment_date: normalizeDate(firstRow['Shipment Date']),
            reference_1: firstRow['Shipment Reference 1'] || null,
            shipment_total: normalizeAmount(firstRow['Total amount (excl. VAT)']),
        });

        const charges = [];
        let lineNo = 1;
        const pushCharge = (name, amount, code = null, taxCode = null) => {
            const parsed = normalizeAmount(amount);
            if (parsed === null || parsed === 0) {
                return;
            }
            charges.push({
                shipment_id: shipmentId,
                charge_group: classifyDhlCharge(name, taxCode),
                charge_name_raw: name,
                amount: parsed,
                charge_code: code,
                line_no: lineNo,
            });
            lineNo += 1;
        };

        groupRows.forEach((row) => {
            const product = String(row['Product'] || '').toLowerCase();
            if (product.includes('duties') || product.includes('tax')) {
                pushCharge(row['Product Name'] || 'DUTIES & TAXES', row['Total amount (excl. VAT)'], row['Product'], row['Tax Code']);
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
        processed += 1;
    }
    return { processed };
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
                    const result = isFedex
                        ? await processFedexRows(rows, sourceFileName)
                        : await processDhlRows(rows, sourceFileName);
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            })
            .on('error', (error) => reject(error));
    });
}

module.exports = {
    updateCategoriesFromCSV,
    updateTrafficFromCSV,
    updateActiveListingsCSV,
    updateShippingCostsFromCSV,
    updateCarrierInvoicesFromCSV
};
