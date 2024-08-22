const supabase = require('../supabaseClient');
const dayjs = require('dayjs');
require('dotenv').config();

// 次月を計算する関数
const getNextMonth = (reportMonth) => {
  const [year, month] = reportMonth.split('-').map(Number);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
};

// ordersテーブルから指定された月の注文データを取得する関数
const getOrdersForMonth = async (userId, reportMonth) => {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('user_id', userId)
    .gte('order_date', `${reportMonth}-01`)
    .lt('order_date', `${getNextMonth(reportMonth)}-01`);

  if (error) {
    console.error('Error fetching orders:', error.message);
    return { data: null, error };
  }

  console.log('Orders fetched:', data.length);
  return { data, error: null };
};

// itemsテーブルとtraffic_historyテーブルを基にして検索およびサマリー計算を行う関数
async function searchItems(queryParams) {
  const { user_id, ebay_user_id, category_id, report_month, item_title, limit = 100, offset = 0 } = queryParams;

  const numericLimit = parseInt(limit, 10);
  const numericOffset = parseInt(offset, 10);

  console.log('Applying limit:', numericLimit, 'and offset:', numericOffset);

  // 今月かどうかを判定
  const currentMonth = dayjs().format('YYYY-MM');
  const isCurrentMonth = report_month === currentMonth;

  // 使用するテーブルを選択
  const tableName = isCurrentMonth ? 'items' : 'traffic_history';

  // itemsまたはtraffic_historyテーブルから該当するebay_item_idを取得し、itemsテーブルのデータと結合
  let itemsQuery = supabase
    .from('items')
    .select('ebay_item_id, title, category_id, category_name')  // 必要なカラムを選択
    .eq('user_id', user_id)
    .eq('listing_status', 'ACTIVE'); // ACTIVE のみを選択

  if (ebay_user_id) {
    itemsQuery = itemsQuery.eq('ebay_user_id', ebay_user_id);
  }
  if (category_id) {
    itemsQuery = itemsQuery.eq('category_id', category_id);
  }
  if (item_title) {
    itemsQuery = itemsQuery.like('title', `%${item_title}%`);
  }

  const { data: itemsData, error: itemsError } = await itemsQuery;
  if (itemsError) {
    throw new Error(`Error fetching items: ${itemsError.message}`);
  }

  // 対象のebay_item_idをリストに変換
  const ebayItemIds = itemsData.map(item => item.ebay_item_id);

  if (ebayItemIds.length === 0) {
    console.log('No matching items found in items table.');
    return { items: [], summary: { totalListings: 0, totalSales: 0, totalRevenue: 0, totalProfit: 0, averagePrice: 0, averageProfitMargin: 0 } };
  }

  // Supabaseからtraffic_historyテーブルのデータをバッチ処理で取得し、itemsテーブルと結合
  const batchSize = 500;
  let trafficData = [];

  for (let i = 0; i < ebayItemIds.length; i += batchSize) {
    const batch = ebayItemIds.slice(i, i + batchSize);

    const { data: batchData, error: batchError } = await supabase
      .from(tableName)
      .select('ebay_item_id, report_month, monthly_impressions, monthly_views, monthly_sales_conversion_rate')
      .in('ebay_item_id', batch)
      .eq('report_month', report_month)
      .range(numericOffset, numericOffset + numericLimit - 1);

    if (batchError) {
      throw new Error(`Error fetching traffic data: ${batchError.message}`);
    }

    // itemsDataの情報をtrafficDataにマージ
    const mergedData = batchData.map(trafficItem => {
      const matchedItem = itemsData.find(item => item.ebay_item_id === trafficItem.ebay_item_id);
      return {
        ...trafficItem,
        title: matchedItem ? matchedItem.title : null,
        category_id: matchedItem ? matchedItem.category_id : null,
        category_name: matchedItem ? matchedItem.category_name : null,
      };
    });

    trafficData = trafficData.concat(mergedData);
  }

  console.log('Items found with pagination:', trafficData.length);

  // ordersテーブルの検索クエリ
  const { data: ordersData, error: ordersError } = await getOrdersForMonth(user_id, report_month);

  if (ordersError) {
    console.error(`Error fetching orders: ${ordersError.message}`);
    throw new Error(`Error fetching orders: ${ordersError.message}`);
  }

  if (!ordersData || ordersData.length === 0) {
    console.warn('No orders found for the given query');
  } else {
    console.log('Orders found:', ordersData.length);
  }

  const summary = {
    totalListings: trafficData.length,
    totalSales: 0,
    totalRevenue: 0,
    totalProfit: 0,
    averagePrice: 0,
    averageProfitMargin: 0,
  };

  const itemSalesData = {};

  ordersData.forEach((order) => {
    const itemId = order.ebay_item_id;
    if (!itemSalesData[itemId]) {
      itemSalesData[itemId] = {
        sales: 0,
        revenue: 0,
        profit: 0,
      };
    }

    itemSalesData[itemId].sales += 1;
    itemSalesData[itemId].revenue += order.price;
    itemSalesData[itemId].profit += order.profit;
  });

  Object.values(itemSalesData).forEach((item) => {
    summary.totalSales += item.sales;
    summary.totalRevenue += item.revenue;
    summary.totalProfit += item.profit;
  });

  if (summary.totalSales > 0) {
    summary.averagePrice = summary.totalRevenue / summary.totalSales;
    summary.averageProfitMargin = (summary.totalProfit / summary.totalRevenue) * 100;
  }

  console.log('Summary calculated:', summary);

  return {
    items: trafficData,
    summary,
  };
}

module.exports = { searchItems, getOrdersForMonth };
