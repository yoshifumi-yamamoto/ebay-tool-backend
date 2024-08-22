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

async function searchItems(queryParams) {
  const { user_id, ebay_user_id, category_id, report_month, item_title, limit = 100, offset = 0 } = queryParams;

  const numericLimit = parseInt(limit, 10);
  const numericOffset = parseInt(offset, 10);

  console.log('Applying limit:', numericLimit, 'and offset:', numericOffset);

  const currentMonth = dayjs().format('YYYY-MM');
  const isCurrentMonth = report_month === currentMonth;

  let itemsQuery;
  let trafficData = [];

  if (isCurrentMonth) {
    itemsQuery = supabase
      .from('items')
      .select('ebay_item_id, title, category_id, category_name', { count: 'exact' })
      .eq('user_id', user_id)
      .eq('listing_status', 'ACTIVE')
      .eq('report_month', report_month);

    if (ebay_user_id) {
      itemsQuery = itemsQuery.eq('ebay_user_id', ebay_user_id);
    }
    if (category_id) {
      itemsQuery = itemsQuery.eq('category_id', category_id);
    }
    if (item_title) {
      itemsQuery = itemsQuery.like('title', `%${item_title}%`);
    }
  } else {
    itemsQuery = supabase
      .from('traffic_history')
      .select('ebay_item_id', { count: 'exact' })
      .eq('user_id', user_id)
      .eq('report_month', report_month);

    if (ebay_user_id) {
      itemsQuery = itemsQuery.eq('ebay_user_id', ebay_user_id);
    }

    const { data: itemsData, error: itemsError } = await itemsQuery;
    if (itemsError) {
      throw new Error(`Error fetching items: ${itemsError.message}`);
    }

    const ebayItemIds = itemsData.map(item => item.ebay_item_id);

    if (ebayItemIds.length > 0) {
      const batchSize = 500;
      for (let i = 0; i < ebayItemIds.length; i += batchSize) {
        const batch = ebayItemIds.slice(i, i + batchSize);
        const { data: batchData, error: batchError } = await supabase
          .from('traffic_history')
          .select('ebay_item_id, report_month, monthly_impressions, monthly_views, monthly_sales_conversion_rate')
          .in('ebay_item_id', batch)
          .eq('report_month', report_month);

        if (batchError) {
          throw new Error(`Error fetching traffic data: ${batchError.message}`);
        }

        trafficData = trafficData.concat(batchData);
      }

      if (trafficData.length > 0) {
        let mergedData = [];
        for (let i = 0; i < ebayItemIds.length; i += batchSize) {
          const batch = ebayItemIds.slice(i, i + batchSize);
          const { data: additionalItemsData, error: additionalItemsError } = await supabase
            .from('items')
            .select('ebay_item_id, title, category_id, category_name')
            .in('ebay_item_id', batch);

          if (additionalItemsError) {
            throw new Error(`Error fetching items for merging: ${additionalItemsError.message}`);
          }

          mergedData = mergedData.concat(
            trafficData.map(trafficItem => {
              const matchedItem = additionalItemsData.find(item => item.ebay_item_id === trafficItem.ebay_item_id);
              return {
                ...trafficItem,
                title: matchedItem ? matchedItem.title : null,
                category_id: matchedItem ? matchedItem.category_id : null,
                category_name: matchedItem ? matchedItem.category_name : null,
              };
            })
          );
        }
        trafficData = mergedData;
      }
    }
  }

  const { count: totalItemsCount, error: totalItemsError } = await itemsQuery;
  if (totalItemsError) {
    throw new Error(`Error fetching total items count: ${totalItemsError.message}`);
  }

  console.log('Total Items Count before pagination:', totalItemsCount);

  const paginatedItemsQuery = itemsQuery.range(numericOffset, numericOffset + numericLimit - 1);
  const { data: paginatedItemsData, error: paginatedItemsError } = await paginatedItemsQuery;

  if (paginatedItemsError) {
    throw new Error(`Error fetching paginated items: ${paginatedItemsError.message}`);
  }

  console.log('Paginated Items Data:', paginatedItemsData.length);

  const finalItemsData = isCurrentMonth ? paginatedItemsData : trafficData.slice(numericOffset, numericOffset + numericLimit);

  console.log('Final Items Data after pagination:', finalItemsData.length);

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
    items: finalItemsData,
    summary,
  };
}

module.exports = { searchItems, getOrdersForMonth };
