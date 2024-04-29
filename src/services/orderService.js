const axios = require('axios');
const { getEbayUserToken } = require('./authService');
const supabase = require('../supabaseClient');
const { fetchBuyerByEbayId } = require('./buyerService'); // 必要な関数をインポート

async function fetchOrdersFromEbay() {
    const accessToken = await getEbayUserToken();
    try {
        const response = await axios({
            method: 'get',
            url: 'https://api.ebay.com/sell/fulfillment/v1/order',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
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
  console.log('Received orders to save:', orders.length); // 受け取った注文数をログ出力
  for (const order of orders) {
      const buyer = buyers.find(b => b.ebay_buyer_id === order.buyer.username);
      if (!buyer) {
          console.error('No buyer found for order:', order.orderId);
          continue;
      }

      const orderData = {
        order_no: order.orderId,
        order_date: order.creationDate,
        total_amount: order.totalFeeBasisAmount.value,
        ebay_buyer_id: order.buyer.username,
        buyer_id: buyer.id, // このバイヤーIDを使用して注文を保存
        status: order.orderPaymentStatus
      };

      const { data, error } = await supabase.from('orders').insert([orderData]);
      if (error) {
          console.error('Error saving order to Supabase:', error.message, 'with orderData:', orderData);
          continue;
      }
      console.log('Order saved successfully:', data);
  }
}


module.exports = {
  fetchOrdersFromEbay,
  saveOrdersToSupabase
};
