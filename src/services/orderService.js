const axios = require('axios');
const { getEbayUserToken } = require('./authService');  // 正しいパスを指定


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

const supabase = require('../supabaseClient');

async function saveOrdersToSupabase(orders) {
  for (const order of orders) {
      const { data: existingOrder, error: existingOrderError } = await supabase
          .from('orders')
          .select('*')
          .eq('order_no', order.orderId)
          .single();

      if (existingOrderError) {
          console.error('Error checking existing order:', existingOrderError);
          continue;
      }

      if (!existingOrder) {
          // 注文が存在しない場合は新規挿入
          const { data, error } = await supabase
              .from('orders')
              .insert([{
                order_no: order.orderId,
                order_date: order.creationDate,
                total_amount: order.totalFeeBasisAmount.value,
                buyer_id: order.buyer.username,
                ebay_user_id: 2,
                status: order.orderPaymentStatus
              }]);
          if (error) {
              console.error('Error saving new order to Supabase:', error);
          } else {
              console.log('Order saved successfully:', data);
          }
      } else {
          // 既存の注文がある場合は更新
          const { data, error } = await supabase
              .from('orders')
              .update({
                total_amount: order.totalFeeBasisAmount.value,
                buyer_id: order.buyer.username,
                ebay_user_id: 2,
                status: order.orderPaymentStatus
              })
              .eq('order_no', order.orderId);

          if (error) {
              console.error('Error updating order:', error);
          } else {
              console.log('Order updated successfully:', data);
          }
      }
  }
}

module.exports = {
  fetchOrdersFromEbay,
  saveOrdersToSupabase
};