const axios = require('axios');
const { getEbayUserToken } = require('./authService');
const supabase = require('../supabaseClient');
const { fetchBuyerByEbayId, fetchAllBuyers } = require('./buyerService'); // 必要な関数をインポート
const { fetchEbayAccountTokens, refreshEbayToken } = require("./accountService")
const { fetchItemImages, fetchItemImage, fetchItemDetails } = require("./itemService")

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

async function saveOrdersToSupabase(orders, buyers) {
    for (const order of orders) {
        // バイヤー情報の検索（見つからない場合はnullを許容）
        const buyer = buyers.find(b => b.ebay_buyer_id === order.ebay_buyer_id);

        // 注文データの準備
        const orderData = {
            order_no: order.order_no,
            order_date: order.order_date,
            total_amount: order.total_amount,
            ebay_buyer_id: order.ebay_buyer_id,
            buyer_id: buyer ? buyer.id : null, // バイヤーIDはバイヤーが見つかった場合のみ設定
            status: order.status
        };

        // 注文データの保存（upsert操作）
        const { data, error } = await supabase.from('orders').upsert(orderData, {
            onConflict: "order_no" // 'order_no'をコンフリクト解決のキーとして使用
        });

        if (error) {
            console.error('Error saving/updating order in Supabase:', error.message, 'Order Data:', orderData);
            continue;
        }
        console.log('Order processed successfully:', data);
    }
}

// orderService.js
const { upsertBuyer } = require('./buyerService');

async function processOrdersAndBuyers(orders) {
    if (!Array.isArray(orders)) {
        console.error('Invalid order data:', orders);
        throw new Error('Invalid order data. Orders should be an array.');
    }

    const buyers = await fetchAllBuyers();  // すべてのバイヤーデータを取得
    const orderDatas = [];  // 注文データを格納する配列

    for (const order of orders) {
        // バイヤー情報のアップサート（挿入または更新）
        const buyerInfo = {
            ebay_buyer_id: order.buyer.username,
            name: order.buyer.buyerRegistrationAddress.fullName,
            registered_date: new Date().toISOString()
        };
        const buyer = await upsertBuyer(buyerInfo);

        // 注文データを準備
        const orderData = {
            order_no: order.orderId,
            order_date: order.creationDate,
            total_amount: order.totalFeeBasisAmount.value,
            ebay_buyer_id: order.buyer.username,
            buyer_id: buyer.id,
            status: order.orderPaymentStatus
        };
        orderDatas.push(orderData);
    }

    // すべての注文データを一括で保存
    await saveOrdersToSupabase(orderDatas, buyers);
}

// すべての注文とバイヤー情報をSupabaseに保存する関数
async function saveOrdersAndBuyers(userId) {
    const tokens = await fetchEbayAccountTokens(userId);
    for (let token of tokens) {
        try {
            const accessToken = await refreshEbayToken(token)
            const orders = await fetchOrdersFromEbay(accessToken);
            
            const legacyItemIds = orders.flatMap(order => order.lineItems.map(item => item.legacyItemId));

            // Supabaseから既存の注文を取得
            const { data: existingOrders, error: existingOrdersError } = await supabase
                .from('orders')
                .select('order_no, line_items')
                .in('order_no', orders.map(order => order.orderId));

            if (existingOrdersError) {
                console.error('Error fetching existing orders from Supabase:', existingOrdersError.message);
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

            for (let order of orders) {
                try {
                    const buyer = await upsertBuyer({
                        ebay_buyer_id: order.buyer.username,
                        name: order.buyer.buyerRegistrationAddress.fullName,
                        user_id: userId,
                        ebay_user_id: order.sellerId,
                        address: order.buyer.buyerRegistrationAddress.contactAddress,
                        phone_number: order.buyer.buyerRegistrationAddress.primaryPhone.phoneNumber,
                        last_purchase_date: order.creationDate,
                        registered_date: new Date().toISOString()
                    });
                    if (!buyer) {
                        console.error("Buyer upsert failed for order:", order);
                        continue;
                    }

                    const lineItemFulfillmentStatus = order.lineItems?.[0]?.lineItemFulfillmentStatus || 'NOT_STARTED';

                    const lineItems = await Promise.all(order.lineItems.map(async (item) => {
                        let itemImage = existingImages[item.legacyItemId];
                        if (!itemImage) {
                            try {
                                const itemDetails = await fetchItemDetails(item.legacyItemId, accessToken);
                                itemImage = itemDetails ? itemDetails.PictureURL : null;
                            } catch (error) {
                                console.error('Error fetching item image:', error.message);
                                itemImage = null;
                            }
                        }
                        return {
                            ...item,
                            itemImage,
                        };
                    }));

                    const { data, error } = await supabase.from('orders').upsert({
                        order_no: order.orderId,
                        order_date: order.creationDate,
                        total_amount: order.totalFeeBasisAmount.value,
                        ebay_buyer_id: order.buyer.username,
                        buyer_id: buyer.id,
                        user_id: userId,
                        ebay_user_id: order.sellerId,
                        line_items: lineItems,
                        ship_to: order.fulfillmentStartInstructions[0].shippingStep.shipTo,
                        shipping_deadline: order.lineItems[0].lineItemFulfillmentInstructions.shipByDate,
                        ebay_shipment_status: lineItemFulfillmentStatus,
                        status: order.orderPaymentStatus,
                        delivered_msg_status: 'UNSEND'
                    }, { onConflict: 'order_no' });
                    if (error) {
                        console.error('Error saving/updating order in Supabase:', error.message);
                    }
                } catch (error) {
                    console.error('Error processing order:', error);
                }
            }
        } catch (error) {
            console.error('Failed to fetch or process orders:', error);
        }
    }
}


  
async function getOrdersByUserId (userId) {
    let { data: orders, error } = await supabase
        .from('orders')
        .select('*')
        .eq('user_id', userId);

    if (error) throw new Error('Failed to fetch orders: ' + error.message);
    return orders;
};

// ebay上で未発送かつ発送後のmsgを送っていないデータを取得
async function fetchRelevantOrders(userId) {
    const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('user_id', userId)
        .or('ebay_shipment_status.neq.FULFILLED,delivered_msg_status.neq.SEND');

    if (error) {
        console.error('Error fetching relevant orders:', error.message);
        return [];
    }

    return data;
}


async function updateOrder(orderId, orderData) {
    const { data, error } = await supabase
        .from('orders')
        .update(orderData)
        .eq('id', orderId)
        .single(); // .single() を追加して、1つのオブジェクトを返すようにします。
    if (error) throw new Error('Failed to update order: ' + error.message);
    return data; // dataは更新された注文のオブジェクトであることを確認してください。
};


module.exports = {
  fetchOrdersFromEbay,
  saveOrdersToSupabase,
  processOrdersAndBuyers,
  saveOrdersAndBuyers,
  getOrdersByUserId,
  fetchRelevantOrders,
  updateOrder
};
