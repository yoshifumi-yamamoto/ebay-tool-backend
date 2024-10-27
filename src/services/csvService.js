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


module.exports = {
    updateCategoriesFromCSV,
    updateTrafficFromCSV,
    updateActiveListingsCSV
};
