const axios = require('axios');
const { getEbayUserToken } = require('./authService');
const supabase = require('../supabaseClient');
const { fetchBuyerByEbayId, fetchAllBuyers } = require('./buyerService'); // 必要な関数をインポート

async function fetchOrdersFromEbay(accessToken) {
    try {
        const response = await axios({
            method: 'get',
            url: 'https://api.ebay.com/sell/fulfillment/v1/order',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            }
        });
        // console.log('Fetched orders:', response.data); // レスポンス構造を確認
        return response.data.orders;
    } catch (error) {
        console.error('Error fetching orders from eBay:', error);
        throw error;
    }
}


async function saveOrdersToSupabase(orders, buyers) {
    for (const order of orders) {
        console.log("Processing order:", order);

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
  


module.exports = {
  fetchOrdersFromEbay,
  saveOrdersToSupabase,
  processOrdersAndBuyers
};
