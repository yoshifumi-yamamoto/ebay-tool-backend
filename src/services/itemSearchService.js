const supabase = require('../supabaseClient');
const dayjs = require('dayjs');
require('dotenv').config();

const getNextMonth = (reportMonth) => {
  const [year, month] = reportMonth.split('-').map(Number);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
};

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

const getChildCategoryIdsRecursively = async (parentCategoryId) => {
  // 全てのカテゴリデータを一度に取得
  const { data, error } = await supabase
    .from('categories')
    .select('category_id, parent_category_id');

  if (error) {
    console.error('Error fetching categories:', error.message);
    return [];
  }

  const categoryMap = data.reduce((map, category) => {
    if (!map[category.parent_category_id]) {
      map[category.parent_category_id] = [];
    }
    map[category.parent_category_id].push(category.category_id);
    return map;
  }, {});

  const allChildCategoryIds = [];
  const fetchChildIds = (parentId) => {
    if (categoryMap[parentId]) {
      categoryMap[parentId].forEach((childId) => {
        allChildCategoryIds.push(childId);
        fetchChildIds(childId);
      });
    }
  };

  fetchChildIds(parentCategoryId);
  return allChildCategoryIds;
};



async function searchItems(queryParams) {
  const { user_id, ebay_user_id, category_id, report_month, listing_title, limit = 100, offset = 0 } = queryParams;

  const numericLimit = parseInt(limit, 10);
  const numericOffset = parseInt(offset, 10);

  console.log('Applying limit:', numericLimit, 'and offset:', numericOffset);

  let trafficQuery = supabase
    .from('traffic_history')
    .select('*', { count: 'exact' })
    .eq('user_id', user_id)
    .eq('report_month', report_month);

  if (ebay_user_id) {
    trafficQuery = trafficQuery.eq('ebay_user_id', ebay_user_id);
  }

  if (category_id) {
    const allChildCategoryIds = await getChildCategoryIdsRecursively(category_id);
    trafficQuery = trafficQuery.in('category_id', [category_id, ...allChildCategoryIds]);
  }

  if (listing_title) {
    trafficQuery = trafficQuery.like('listing_title', `%${listing_title}%`);
  }

  const { data: trafficData, count: totalItemsCount, error: trafficError } = await trafficQuery.range(numericOffset, numericOffset + numericLimit - 1);

  if (trafficError) {
    throw new Error(`Error fetching traffic data: ${trafficError.message}`);
  }

  console.log('Total Items Count:', totalItemsCount);
  console.log('Fetched Traffic Data:', trafficData.length);

  const { data: ordersData, error: ordersError } = await getOrdersForMonth(user_id, report_month);

  if (ordersError) {
    console.error(`Error fetching orders: ${ordersError.message}`);
    throw new Error(`Error fetching orders: ${ordersError.message}`);
  }

  const summary = {
    totalListings: totalItemsCount,
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
