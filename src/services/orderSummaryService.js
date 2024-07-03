const supabase = require('../supabaseClient');

const DOLLAR_TO_YEN_RATE = 150; // ドル円レートを150円に設定

// 利益額と利益率を計算する関数を追加
function calculateProfitAndMargin(order) {
  const totalCostYen = order.line_items.reduce((sum, item) => sum + parseFloat(item.cost_price) || 0, 0) + parseFloat(order.shipping_cost) || 0;
  const earningsAfterPLFeeYen = (order.earnings_after_pl_fee * 0.98) * DOLLAR_TO_YEN_RATE; // 手数料を引いて円に換算
  const profit = earningsAfterPLFeeYen - totalCostYen;
  const profitMargin = (profit / earningsAfterPLFeeYen) * 100; // 利益率を計算
  return { profit, profitMargin };
}

exports.fetchOrdersWithFilters = async (filters) => {
  const { start_date, end_date, user_id, ebay_user_id, status, buyer_country_code, page = 1, limit = 20 } = filters;

  const offset = (page - 1) * limit;

  // データ取得クエリ
  let query = supabase
      .from('orders')
      .select(`
          id,
          order_no,
          order_date,
          earnings,
          earnings_after_pl_fee,
          shipping_cost,
          subtotal,
          status,
          buyer_country_code,
          researcher,
          line_items,
          ebay_user_id
      `)
      .eq('user_id', user_id)
      .neq('status', 'FULLY_REFUNDED') // FULLY_REFUNDEDステータスを除外
      .gte('order_date', start_date)
      .lte('order_date', end_date)
      .range(offset, offset + limit - 1); // ページネーションの範囲を設定

  if (ebay_user_id) query = query.eq('ebay_user_id', ebay_user_id);
  if (status) query = query.eq('status', status);
  if (buyer_country_code) query = query.eq('buyer_country_code', buyer_country_code);

  const { data, error } = await query;

  if (error) {
      console.error('Error fetching orders:', error.message);
      throw error;
  }

  const ordersWithProfit = data.map(order => {
      const { profit, profitMargin } = calculateProfitAndMargin(order);
      return { ...order, profit, profitMargin };
  });

  // 総注文数取得クエリ
  let countQuery = supabase
      .from('orders')
      .select('id', { count: 'exact' })
      .eq('user_id', user_id)
      .neq('status', 'FULLY_REFUNDED') // FULLY_REFUNDEDステータスを除外
      .gte('order_date', start_date)
      .lte('order_date', end_date);

  if (ebay_user_id) countQuery = countQuery.eq('ebay_user_id', ebay_user_id);
  if (status) countQuery = countQuery.eq('status', status);
  if (buyer_country_code) countQuery = countQuery.eq('buyer_country_code', buyer_country_code);

  const { count, error: countError } = await countQuery;

  if (countError) {
      console.error('Error fetching order count:', countError.message);
      throw countError;
  }

  return { orders: ordersWithProfit, totalOrders: count };
};

exports.fetchOrderSummary = async (filters) => {
  const { user_id, start_date, end_date, ebay_user_id, status, buyer_country_code, researcher } = filters;

  if (!user_id) {
    throw new Error('User ID is required');
  }

  let query = supabase
    .from('orders')
    .select('earnings_after_pl_fee, subtotal, shipping_cost, line_items, researcher, line_items')
    .eq('user_id', user_id) // 必須フィルタとしてuser_idを追加
    .neq('status', 'FULLY_REFUNDED') // FULLY_REFUNDEDステータスを除外
    .gte('order_date', start_date)
    .lte('order_date', end_date);

  if (ebay_user_id) query = query.eq('ebay_user_id', ebay_user_id);
  if (status) query = query.eq('status', status);
  if (buyer_country_code) query = query.eq('buyer_country_code', buyer_country_code);
  if (researcher) query = query.eq('researcher', researcher);

  const { data, error } = await query;

  if (error) throw error;

  const totalSales = data.reduce((sum, order) => sum + order.earnings_after_pl_fee, 0);
  const totalProfit = data.reduce((sum, order) => {
    const { profit } = calculateProfitAndMargin(order);
    return sum + profit;
  }, 0);
  const totalSubtotal = data.reduce((sum, order) => sum + order.subtotal, 0);
  const totalOrders = data.length;
  const profitMargin = (totalProfit / (totalSales * 0.98 * DOLLAR_TO_YEN_RATE)) * 100;

  const researcherIncentives = data.reduce((acc, order) => {
    const { researcher, earnings_after_pl_fee } = order;
    if (researcher) {
      if (!acc[researcher]) acc[researcher] = 0;
      acc[researcher] += earnings_after_pl_fee * 0.1; // 仮のインセンティブ率 10%
    }
    return acc;
  }, {});

  return {
    total_sales: totalSales,
    total_orders: totalOrders,
    total_profit: totalProfit,
    profit_margin: profitMargin,
    total_subtotal: totalSubtotal,
    researcher_incentives: researcherIncentives,
  };
};
