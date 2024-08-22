const csv = require('csv-parser');
const fs = require('fs');
const supabase = require('../supabaseClient');

const batchSize = 100; // バッチサイズを設定
const concurrencyLimit = 5; // 並行処理のリミットを設定

async function processBatches(updates, type) {
    const promises = [];

    for (let i = 0; i < updates.length; i += batchSize) {
        const batch = updates.slice(i, i + batchSize);

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

async function upsertItemsTable(updates) {
    await processBatches(updates, 'category');
}

async function migrateToTrafficHistory(updates) {
    await processBatches(updates, 'traffic');
}

async function updateCategoriesFromCSV(filePath, userId) {
    const results = [];

    fs.createReadStream(filePath)
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
                user_id: userId // user_id を付与
            })).filter(update => update.ebay_item_id);

            await upsertItemsTable(updates);
            console.log('CSV processing for categories completed.');
        });
}

async function updateTrafficFromCSV(filePath, month, userId) {
    const results = [];

    fs.createReadStream(filePath)
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
            const itemIds = results.map(row => row['eBay item ID']).filter(Boolean);
            
            const chunkSize = 1000; 
            const itemsToUpdate = [];
            const itemsToMigrate = [];

            const currentDate = new Date();
            const currentMonth = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;

            for (let i = 0; i < itemIds.length; i += chunkSize) {
                const chunk = itemIds.slice(i, i + chunkSize);
                
                const { data: items, error } = await supabase
                    .from('items')
                    .select('ebay_item_id, report_month')
                    .in('ebay_item_id', chunk);

                if (error) {
                    console.error('Error fetching items:', error.message);
                    continue;
                }

                results.forEach(row => {
                    const item = items.find(item => item.ebay_item_id === row['eBay item ID']);
                    
                    let salesConversionRate = row['Sales conversion rate = Quantity sold/Total page views'];
                    if (salesConversionRate === '-' || !salesConversionRate || salesConversionRate.trim() === '') {
                        salesConversionRate = null;
                    } else {
                        salesConversionRate = parseFloat(salesConversionRate.replace('%', '').trim()) / 100.0;
                    }

                    const updateData = {
                        ebay_item_id: row['eBay item ID'],
                        report_month: month,
                        monthly_impressions: parseInt(row['Total impressions on eBay site'], 10) || 0,
                        monthly_views: parseInt(row['Total page views'], 10) || 0,
                        monthly_sales_conversion_rate: salesConversionRate,
                        user_id: userId // user_id を付与
                    };

                    if (!item || item.report_month !== month) {
                        if (month === currentMonth) {
                            itemsToUpdate.push(updateData);
                        } else {
                            itemsToMigrate.push(updateData);
                        }
                    }
                });
            }

            if (itemsToUpdate.length > 0) {
                await upsertItemsTable(itemsToUpdate);
            }

            if (itemsToMigrate.length > 0) {
                await migrateToTrafficHistory(itemsToMigrate);
            }

            console.log('CSV processing for traffic completed.');
        });
}

module.exports = {
    updateCategoriesFromCSV,
    updateTrafficFromCSV,
};
