const axios = require('axios');
const supabase = require('../supabaseClient');
const { fetchEbayAccountTokens, refreshEbayToken } = require("./accountService")
const { fetchItemDetails } = require("./itemService")
const { upsertBuyer } = require('./buyerService');
const { logError } = require('./loggingService');

async function fetchOrdersFromEbay(refreshToken) {
    try {
        const response = await axios({
            method: 'get',
            url: 'https://api.ebay.com/sell/fulfillment/v1/order',
            headers: {
                'Authorization': `Bearer ${refreshToken}`,
                'Content-Type': 'application/json',
            }
        });
        return response.data.orders;
    } catch (error) {
        console.error('Error fetching orders from eBay:', error);
        throw error;
    }
}

/**
 * 注文情報からバイヤー情報を取得し、データベースにアップサートする関数
 * @param {Object} order - バイヤー情報を含む注文オブジェクト
 * @param {number} userId - ユーザーID
 * @returns {Object} - バイヤー情報
 */
async function fetchAndUpsertBuyer(order, userId) {
    return await upsertBuyer({
        ebay_buyer_id: order.buyer.username,
        name: order.buyer.buyerRegistrationAddress.fullName,
        user_id: userId,
        ebay_user_id: order.sellerId,
        address: order.buyer.buyerRegistrationAddress.contactAddress,
        phone_number: order.buyer.buyerRegistrationAddress.primaryPhone.phoneNumber,
        last_purchase_date: order.creationDate,
        registered_date: new Date().toISOString()
    });
}

/**
 * 商品画像の取得やitemsテーブルからの商品データの更新を含む、ラインアイテムを取得して処理する関数
 * @param {Object} order - ラインアイテムを含む注文オブジェクト
 * @param {string} accessToken - eBay APIのアクセストークン
 * @param {Object} existingImages - 既存の画像マップ
 * @param {Object} itemsMap - itemsテーブルからの商品のマップ
 * @returns {Array} - 処理されたラインアイテム
 */
async function fetchAndProcessLineItems(order, accessToken, existingImages, itemsMap) {
    return await Promise.all(order.lineItems.map(async (item) => {
        let itemImage = existingImages[item.legacyItemId];
        if (!itemImage) {
            try {

                const itemDetails = await fetchItemDetails(item.legacyItemId, accessToken);
                itemImage = itemDetails ? itemDetails.PictureDetails.PictureURL[0] : null;
            } catch (error) {

                console.error('商品画像の取得エラー:', error.message);
                itemImage = null;
            }
        }

        const itemData = itemsMap[item.legacyItemId];
        return {
            ...item,
            itemImage,
            stocking_url: itemData ? itemData.stocking_url : null,
            cost_price: itemData ? itemData.cost_price : null
        };
    }));
}

/**
 * 注文明細をorder_line_itemsテーブルにアップサートする
 * @param {Object} order - eBay注文データ
 * @param {Array} lineItems - 加工済みラインアイテム
 * @param {string} researcher - リサーチ担当者
 */
async function upsertOrderLineItems(order, lineItems, researcher) {
    if (!lineItems?.length) {
        return;
    }

    const lineItemIds = lineItems.map((item) => item.lineItemId);
    const { data: existingLineItems, error: fetchError } = await supabase
        .from('order_line_items')
        .select('id, procurement_tracking_number, procurement_url, procurement_status')
        .in('id', lineItemIds);

    if (fetchError && fetchError.code !== 'PGRST116') {
        console.error('order_line_items取得時のエラー:', fetchError.message);
    }

    const existingMap = {};
    existingLineItems?.forEach((item) => {
        existingMap[item.id] = item;
    });

    const toNumber = (value) => {
        if (value === undefined || value === null) {
            return null;
        }
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    };

    const records = lineItems.map((item) => {
        const existing = existingMap[item.lineItemId] || {};
        return {
            id: item.lineItemId,
            order_no: order.orderId,
            legacy_item_id: item.legacyItemId || null,
            title: item.title || null,
            quantity: item.quantity ?? null,
            total_value: toNumber(item.total?.value),
            total_currency: item.total?.currency || null,
            line_item_cost_value: toNumber(item.lineItemCost?.value),
            line_item_cost_currency: item.lineItemCost?.currency || null,
            cost_price: toNumber(item.cost_price),
            item_image: item.itemImage || null,
            stocking_url: item.stocking_url || null,
            researcher: researcher || item.researcher || null,
            procurement_tracking_number: existing.procurement_tracking_number || null,
            procurement_url: existing.procurement_url || item.stocking_url || null,
            procurement_status: existing.procurement_status || null,
            updated_at: new Date().toISOString()
        };
    });

    const { error: upsertError } = await supabase
        .from('order_line_items')
        .upsert(records, { onConflict: 'id' });

    if (upsertError) {
        console.error('order_line_itemsへのアップサートエラー:', upsertError.message);
    }
}

/**
 * 注文明細の仕入ステータスを更新する
 * @param {string} lineItemId - eBay lineItemId
 * @param {string} status - 更新後の仕入ステータス
 */
async function updateProcurementStatus(lineItemId, status) {
    const { data, error } = await supabase
        .from('order_line_items')
        .update({
            procurement_status: status,
            updated_at: new Date().toISOString()
        })
        .eq('id', lineItemId)
        .select();

    if (error) {
        throw new Error('Failed to update procurement status: ' + error.message);
    }

    return data?.[0] || null;
}

/**
 * 注文明細の追跡番号を更新する
 * @param {string} lineItemId - eBay lineItemId
 * @param {string|null} trackingNumber - 追跡番号
 */
async function updateProcurementTrackingNumber(lineItemId, trackingNumber) {
    const { data, error } = await supabase
        .from('order_line_items')
        .update({
            procurement_tracking_number: trackingNumber,
            updated_at: new Date().toISOString()
        })
        .eq('id', lineItemId)
        .select();

    if (error) {
        throw new Error('Failed to update procurement tracking number: ' + error.message);
    }

    return data?.[0] || null;
}

/**
 * 複数の注文を発送済みに更新する
 * @param {Array<string>} orderIds - ordersテーブルのidリスト
 */
async function markOrdersAsShipped(orderIds) {
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
        return [];
    }

    const { data, error } = await supabase
        .from('orders')
        .update({
            shipping_status: 'SHIPPED'
        })
        .in('id', orderIds)
        .select('id, order_no, shipping_status');

    if (error) {
        throw new Error('Failed to update shipping status: ' + error.message);
    }

    return data || [];
}

/**
 * 注文情報をSupabaseにアップサートする関数
 * @param {Object} order - 注文の詳細を含む注文オブジェクト
 * @param {number} buyerId - バイヤーID
 * @param {number} userId - ユーザーID
 * @param {Array} lineItems - 処理されたラインアイテム
 * @param {number} shippingCost - 送料
 * @param {string} lineItemFulfillmentStatus - ラインアイテムの履行状況
 * @returns {Object} - 更新された注文データ
 */
async function updateOrderInSupabase(order, buyerId, userId, lineItems, shippingCost, lineItemFulfillmentStatus, researcher) {
    // 注文収益を計算する
    const earningsAfterPlFee = order.paymentSummary.totalDueSeller.value * 0.979; // 注文収益 - プロモーテッドリスティングス(2.1%)

    // 既存のデータを取得
    const { data: existingData, error: fetchError } = await supabase
        .from('orders')
        .select('*')
        .eq('order_no', order.orderId)
        .single();

    if (fetchError && fetchError.code !== 'PGRST116') { // データが存在しない場合のエラーコードを無視
        console.error('Supabaseでの注文データの取得エラー:', fetchError.message);
        return null;
    }

    // マージするデータを作成
    const dataToUpsert = {
        order_no: order.orderId,
        order_date: order.creationDate,
        ebay_buyer_id: order.buyer.username,
        buyer_id: buyerId,
        buyer_country_code: order.buyer.buyerRegistrationAddress.contactAddress.countryCode,
        user_id: userId,
        ebay_user_id: order.sellerId,
        line_items: lineItems.map((item, index) => ({
            ...item,
            cost_price: existingData ? existingData.line_items[index]?.cost_price : item.cost_price, // 更新しない
            researcher: existingData ? existingData.researcher : researcher
        })),
        ship_to: order.fulfillmentStartInstructions[0].shippingStep.shipTo,
        shipping_deadline: order.lineItems[0].lineItemFulfillmentInstructions.shipByDate,
        ebay_shipment_status: lineItemFulfillmentStatus,
        status: order.orderPaymentStatus,
        total_amount: order.totalFeeBasisAmount.value,
        subtotal: order.pricingSummary.priceSubtotal.value,
        earnings: order.paymentSummary.totalDueSeller.value, // 注文収益
        earnings_after_pl_fee: earningsAfterPlFee,
        shipping_cost: existingData ? existingData.shipping_cost : shippingCost, // 更新しない
        researcher: existingData ? existingData.researcher : researcher
    };

    // Supabaseにデータを保存
    const { data, error } = await supabase
        .from('orders')
        .upsert(dataToUpsert, { onConflict: 'order_no' });

    if (error) {
        console.error('Supabaseでの注文の保存/更新エラー:', error.message);
    }
    return data;
}



// すべての注文とバイヤー情報をSupabaseに保存する関数
async function saveOrdersAndBuyers(userId) {
    const tokens = await fetchEbayAccountTokens(userId);
    for (let token of tokens) {
        try {
            const accessToken = await refreshEbayToken(token);
            const orders = await fetchOrdersFromEbay(accessToken);
            
            const legacyItemIds = orders.flatMap(order => order.lineItems.map(item => item.legacyItemId));

            const { data: existingOrders, error: existingOrdersError } = await supabase
                .from('orders')
                .select('order_no, line_items')
                .in('order_no', orders.map(order => order.orderId));

            if (existingOrdersError) {
                console.error('Supabaseからの既存注文の取得エラー:', existingOrdersError.message);
                continue;
            }

            const existingImages = {};
            existingOrders.forEach(order => {
                order.line_items.forEach(item => {

                    if (item.itemImage) {
                        existingImages[item.legacyItemId] = item.itemImage;
                    }
                });
            });

            const { data: itemsData, error: itemsError } = await supabase
                .from('items')
                .select('*')
                .in('ebay_item_id', legacyItemIds);

            if (itemsError) {
                console.error('Supabaseからの商品の取得エラー:', itemsError.message);
                continue;
            }

            const itemsMap = {};
            itemsData.forEach(item => {
                itemsMap[item.ebay_item_id] = item;
            });
            

            for (let order of orders) {
                try {
                    const buyer = await fetchAndUpsertBuyer(order, userId);
                    if (!buyer) {
                        console.error("注文に対するバイヤーのアップサート失敗:", order);
                        continue;
                    }

                    const lineItemFulfillmentStatus = order.lineItems?.[0]?.lineItemFulfillmentStatus || 'NOT_STARTED';

                    const lineItems = await fetchAndProcessLineItems(order, accessToken, existingImages, itemsMap);

                    const shippingCost = itemsMap[lineItems[0].legacyItemId]?.shipping_cost || 0

                    const researcher = itemsMap[lineItems[0].legacyItemId]?.researcher || ""

                    await upsertOrderLineItems(order, lineItems, researcher);
                    
                    await updateOrderInSupabase(order, buyer.id, userId, lineItems, shippingCost, lineItemFulfillmentStatus, researcher);
                } catch (error) {
                    console.log("itemsMap",itemsMap)
                    console.log("order.orderId,",order.orderId)
                    console.error('注文処理エラー:', error);
                    // itemIdを利用できる場合はログに追加
                    const itemId = error?.item?.ItemID?.[0] || 'N/A';

                    await logError({
                        itemId: itemId,  // itemIdをログに追加
                        errorType: 'API_ERROR',
                        errorMessage: error.message,
                        attemptNumber: 1,  // 任意のリトライ回数を指定可能
                        additionalInfo: {
                            functionName: 'saveOrdersAndBuyers',
                        }
                    });
                    
                }
            }
        } catch (error) {
            console.error('注文の取得または処理の失敗:', error);
                // itemIdを利用できる場合はログに追加
            const itemId = error?.item?.ItemID?.[0] || 'N/A';

            await logError({
                itemId: itemId,  // itemIdをログに追加
                errorType: 'API_ERROR',
                errorMessage: error.message,
                attemptNumber: 1,  // 任意のリトライ回数を指定可能
                additionalInfo: {
                    functionName: 'saveOrdersAndBuyers',
                }
            });
        }
    }
}


  
async function getOrdersByUserId (userId) {
    let { data: orders, error } = await supabase
        .from('orders')
        .select('*, order_line_items(*)')
        .eq('user_id', userId);

    if (error) throw new Error('Failed to fetch orders: ' + error.message);
    return orders;
};

// ebay上で未発送かつ発送後のmsgを送っていないデータを取得
async function fetchRelevantOrders(userId) {
    const { data, error } = await supabase
        .from('orders')
        .select('*, order_line_items(*)')
        .eq('user_id', userId)
        .or('shipping_status.neq.SHIPPED,delivered_msg_status.neq.SEND')
        .neq('status', 'FULLY_REFUNDED')
        .order('order_date', { ascending: false })
        .order('created_at', { ascending: true, foreignTable: 'order_line_items' });

    if (error) {
        console.error('Error fetching relevant orders:', error.message);
        return [];
    }

    return data;
}




// 注文データの更新
async function updateOrder(orderId, orderData) {
    try {
        console.log('Updating order with ID:', orderId); // デバッグ情報を追加
        console.log('Order data to update:', orderData); // デバッグ情報を追加

        const updates = {};

        // 動的に更新フィールドを設定
        for (const key in orderData) {
            if (orderData.hasOwnProperty(key)) {
                updates[key] = orderData[key];
            }
        }

        const { data, error } = await supabase
            .from('orders')
            .update(updates)
            .eq('id', orderId)
            .select(); // select()を追加して更新後のデータを返すようにする

        if (error) {
            console.error('Supabase Update Error:', error); // エラー詳細をログに記録
            throw new Error('Failed to update order: ' + error.message);
        }

        if (!data || data.length === 0) {
            console.error('No data returned after update'); // デバッグ情報を追加
            return null;
        }

        console.log('Updated order data:', data[0]); // 成功時のデータをログに記録
        return data[0]; // 配列からオブジェクトを返す
    } catch (err) {
        console.error('Update Order Service Error:', err); // エラー詳細をログに記録
        throw err;
    }
};

/**
 * 先週の月曜日から日曜日の範囲を計算する関数
 * @returns {Object} - 先週の開始日と終了日を含むオブジェクト
 */
function getLastWeekDateRange() {
    const now = new Date();
    // 現在の日付から先週の日曜日を取得
    now.setDate(now.getDate() - now.getDay());
    const lastSunday = new Date(now);
    // 先週の月曜日を取得
    now.setDate(now.getDate() - 6);
    const lastMonday = new Date(now);

    // 先週の月曜日の時刻を00:00:00に設定
    lastMonday.setHours(0, 0, 0, 0);
    // 先週の日曜日の時刻を23:59:59に設定
    lastSunday.setHours(23, 59, 59, 999);

    return { start: lastMonday, end: lastSunday };
}

/**
 * 先週の注文を取得する関数
 * @param {number} userId - ユーザーID
 * @returns {Array} - 先週の注文データ
 */
async function fetchLastWeekOrders(userId) {
    const { start, end } = getLastWeekDateRange();
    const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select('*, order_line_items(*)')
        .eq('user_id', userId)
        .gte('order_date', start.toISOString())
        .lte('order_date', end.toISOString())
        .order('order_date', { ascending: false })
        .order('created_at', { ascending: true, foreignTable: 'order_line_items' });

    if (ordersError) {
        console.error('Error fetching last week orders:', ordersError.message);
        return [];
    }

    // 注文に含まれる全てのitemIdを収集
    const itemIds = [...new Set(orders.flatMap(order => order.line_items.map(item => item.legacyItemId)))];

    // 必要なitemIdだけを使ってitemsテーブルからデータを取得
    const { data: items, error: itemsError } = await supabase
        .from('items')
        .select('*')
        .in('ebay_item_id', itemIds);

    if (itemsError) {
        console.error('Error fetching items:', itemsError.message);
        return [];
    }

    // itemsデータをマップに変換
    const itemsMap = {};
    items.forEach(item => {
        itemsMap[item.ebay_item_id] = item;
    });

    // ordersデータにitemsデータを追加
    const enrichedOrders = orders.map(order => {
        const enrichedLineItems = order.line_items.map(item => {
            const itemData = itemsMap[item.legacyItemId] || {};
            return { ...item, ...itemData };
        });
        return { ...order, line_items: enrichedLineItems };
    });

    return enrichedOrders;
}

module.exports = {
  fetchOrdersFromEbay,
  saveOrdersAndBuyers,
  getOrdersByUserId,
  fetchRelevantOrders,
  updateOrder,
  fetchLastWeekOrders,
  updateProcurementStatus,
  updateProcurementTrackingNumber,
  markOrdersAsShipped
};
