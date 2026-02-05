const supabase = require('../supabaseClient');
const dayjs = require('dayjs');
const { attachNormalizedLineItemsToOrder } = require('./orderService');
require('dotenv').config();

// 仮の為替レート
const USDJPY = 140

const getNextMonth = (reportMonth) => {
  const [year, month] = reportMonth.split('-').map(Number);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
};

const getOrdersForMonth = async (userId, reportMonth, listing_title) => {
  console.log("reportMonth",`${reportMonth}-01`);
  console.log("getNextMonth",`${getNextMonth(reportMonth)}-01`);

  let { data, error } = await supabase
    .from('orders')
    .select('*, order_line_items(*)')
    .eq('user_id', userId)
    .eq('status', "PAID")
    .gte('order_date', `${reportMonth}-01`)
    .lt('order_date', `${getNextMonth(reportMonth)}-01`);

  if (error) {
    console.error('Error fetching orders:', error.message);
    return { data: null, error };
  }

  // 大文字小文字を区別しないように、両方を小文字に変換して比較
  const normalizedTitle = listing_title.toLowerCase();
  const orders = (data || []).map(attachNormalizedLineItemsToOrder);

  const filteredOrdersByTitle = orders.filter(order => 
    order.line_items.some(item => 
      item.title && item.title.toLowerCase().includes(normalizedTitle)
    )
  );

  console.log('Orders fetched:', filteredOrdersByTitle.length);
  return { data: filteredOrdersByTitle, error: null };
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

const filterOrdersByCategory = async (orders, category_id) => {
  const allChildCategoryIds = await getChildCategoryIdsRecursively(category_id);
  const allCategories = [category_id, ...allChildCategoryIds];

  const filteredOrders = [];
  let totalEarnings = 0;
  let totalProfit = 0;
  let totalSubtotal = 0;

  for (const order of orders) {
    let orderProfit = 0;
    let matchFound = false;
    const matchingLineItems = [];

    for (const item of order.line_items) {
      let { data: itemData, error } = await supabase
        .from('items')
        .select('*')
        .eq('ebay_item_id', item.legacyItemId)
        .single();

      if (error) {
        console.error(`Error fetching item with ebay_item_id ${item.legacyItemId}:`, error.message);
        continue;
      }

      if (itemData && allCategories.includes(itemData.category_id)) {
        matchFound = true;
        matchingLineItems.push(item);
        
        // 利益計算
        const earningsAfterFee = order.earnings_after_pl_fee * 0.98;
        const profit = earningsAfterFee - ((order.estimated_shipping_cost / USDJPY) || 0) - ((itemData.cost_price / USDJPY) || 0);
        orderProfit += profit;
        totalProfit += profit;
      }
    }

    if (matchFound) {
      filteredOrders.push({
        ...order,
        line_items: matchingLineItems
      });

      totalEarnings += order.earnings_after_pl_fee * 0.98; // 手数料を引いた額を加算
      totalSubtotal += order.subtotal; // subtotal を合計
    }
  }

  const salesQty = filteredOrders.length;
  const averagePrice = totalSubtotal / salesQty || 0;
  const averageProfit = totalProfit / salesQty || 0;
  const averageProfitMargin = (averageProfit / averagePrice) * 100 || 0;

  return {
    filteredOrders,
    orderSummary: {
      salesQty,
      totalSubtotal,
      totalProfit,
      averagePrice,
      averageProfit,
      averageProfitMargin,
    }
  };
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
    const normalizedTitle = listing_title.toLowerCase();
    trafficQuery = trafficQuery.ilike('listing_title', `%${normalizedTitle}%`);
}

  // 全件の合計を計算するために一度全てのデータを取得
  const { data: allTrafficData, count: totalItemsCount, error: trafficError } = await trafficQuery;

  if (trafficError) {
    throw new Error(`Error fetching traffic data: ${trafficError.message}`);
  }

  console.log('Total Items Count:', totalItemsCount);

  let totalImpressionsSum = 0;
  let totalPageViewsSum = 0;

  allTrafficData.forEach((item) => {
    const totalImpressions = item.total_impressions_on_ebay_site;
    const totalPageViews = item.total_page_views;

    if (!isNaN(totalImpressions)) {
      totalImpressionsSum += totalImpressions;
    }

    if (!isNaN(totalPageViews)) {
      totalPageViewsSum += totalPageViews;
    }
  });

  // 必要なページングされたデータを取得
  const { data: trafficData } = await trafficQuery.range(numericOffset, numericOffset + numericLimit - 1);
  const itemIds = (trafficData || [])
    .map((item) => item.ebay_item_id)
    .filter((id) => !!id);
  let imageMap = {};
  if (itemIds.length > 0) {
    const { data: itemsData, error: itemsError } = await supabase
      .from('items')
      .select('ebay_item_id, primary_image_url')
      .in('ebay_item_id', itemIds);
    if (itemsError) {
      console.error(`Error fetching item images: ${itemsError.message}`);
    } else {
      imageMap = (itemsData || []).reduce((acc, item) => {
        acc[item.ebay_item_id] = item.primary_image_url || null;
        return acc;
      }, {});
    }
  }

  const { data: ordersData, error: ordersError } = await getOrdersForMonth(user_id, report_month, listing_title);

  if (ordersError) {
    console.error(`Error fetching orders: ${ordersError.message}`);
    throw new Error(`Error fetching orders: ${ordersError.message}`);
  }


  const { filteredOrders, orderSummary } = await filterOrdersByCategory(ordersData, category_id);

  console.log("averageProfitMargin",orderSummary.averageProfitMargin)

  const summary = {
    totalListings: totalItemsCount,
    salesQty: orderSummary.salesQty,
    totalRevenue: orderSummary.totalSubtotal,
    averageProfitMargin: orderSummary.averageProfitMargin,
    averagePrice: orderSummary.averagePrice,
    averageProfit: orderSummary.averageProfit,
    totalProfit: orderSummary.totalProfit,
    totalImpressions: totalImpressionsSum,
    totalPageViews: totalPageViewsSum,
    averageImpressions: 0,
    averagePageViews: 0,
    sellThroughRate: 0,
    orders: filteredOrders
  };

  if (summary.salesQty > 0) {
    summary.averagePrice = summary.totalRevenue / summary.salesQty;
    summary.sellThroughRate = (orderSummary.salesQty / summary.totalListings) * 100 || 0;
  }

  if (summary.totalListings > 0) {
    summary.averageImpressions = summary.totalImpressions / summary.totalListings;
    summary.averagePageViews = summary.totalPageViews / summary.totalListings;
  }

  console.log('Summary calculated:', summary);

  const itemsWithImages = (trafficData || []).map((item) => ({
    ...item,
    primary_image_url: imageMap[item.ebay_item_id] || null,
  }));

  return {
    items: itemsWithImages,
    summary,
  };
}

async function searchItemsSimple(queryParams) {
  const { user_id, listing_title, ebay_item_id, sku, limit = 200 } = queryParams;

  if (!user_id) {
    throw new Error('user_id is required');
  }

  const numericLimit = Number.isFinite(Number(limit)) ? Number(limit) : 200;
  let query = supabase
    .from('items')
    .select('ebay_item_id, sku, item_title, stocking_url, cost_price, estimated_shipping_cost, current_price_value, current_price_currency, primary_image_url')
    .eq('user_id', user_id)
    .order('updated_at', { ascending: false })
    .limit(numericLimit);

  if (listing_title) {
    const normalizedTitle = listing_title.trim();
    const tokenizedPattern = normalizedTitle.replace(/\s+/g, '%');
    query = query.ilike('item_title', `%${tokenizedPattern}%`);
  }

  if (ebay_item_id) {
    query = query.eq('ebay_item_id', ebay_item_id);
  }

  if (sku) {
    query = query.ilike('sku', `%${sku.trim()}%`);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Error fetching items: ${error.message}`);
  }

  return { items: data || [] };
}

module.exports = { searchItems, getOrdersForMonth, searchItemsSimple };
