const { Parser } = require('json2csv');
const supabase = require('../supabaseClient');
const { attachNormalizedLineItemsToOrder } = require('./orderService');

const DEFAULT_ORDER_CURRENCY = 'USD';
const INCENTIVE_RATE = 0.1;

const EXCHANGE_RATES_TO_JPY = {
  USD: Number(process.env.EXCHANGE_RATE_USD_TO_JPY) || 150,
  EUR: Number(process.env.EXCHANGE_RATE_EUR_TO_JPY) || null,
  GBP: Number(process.env.EXCHANGE_RATE_GBP_TO_JPY) || null,
  AUD: Number(process.env.EXCHANGE_RATE_AUD_TO_JPY) || null,
  JPY: 1,
};

const toNumber = (value) => {
  if (value === undefined || value === null || value === '') {
    return 0;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const normalized = value.replace(/[^0-9.-]/g, '');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const sumCostPrice = (lineItems = []) =>
  lineItems.reduce((sum, item) => sum + toNumber(item?.cost_price), 0);

const getOrderCurrency = (order) => {
  if (!order) {
    return DEFAULT_ORDER_CURRENCY;
  }
  if (order.currency) {
    return order.currency;
  }
  if (order.order_currency) {
    return order.order_currency;
  }
  const lineItems = order.line_items || order.order_line_items || [];
  for (const item of lineItems) {
    const currency =
      item?.total_currency ||
      item?.total?.currency ||
      item?.line_item_cost_currency ||
      null;
    if (currency) {
      return currency;
    }
  }
  return DEFAULT_ORDER_CURRENCY;
};

const getExchangeRateToJPY = (currency) => {
  if (!currency) {
    return null;
  }
  const normalized = currency.toUpperCase();
  const rate = EXCHANGE_RATES_TO_JPY[normalized];
  return typeof rate === 'number' && Number.isFinite(rate) ? rate : null;
};

const addAmountByCurrency = (bucket, currency, amount) => {
  const numericAmount = toNumber(amount);
  if (!Number.isFinite(numericAmount) || numericAmount === 0) {
    return;
  }
  const key = currency || DEFAULT_ORDER_CURRENCY;
  bucket[key] = (bucket[key] || 0) + numericAmount;
};

const calculateOrderFinancials = (order) => {
  const lineItems = order.line_items || [];
  const currency = getOrderCurrency(order);
  const totalAmount = toNumber(order.total_amount);
  const earnings = toNumber(order.earnings);
  const earningsAfterFee = toNumber(order.earnings_after_pl_fee);
  const shippingCostJpy = toNumber(order.shipping_cost);
  const costPriceJpy = sumCostPrice(lineItems);
  const exchangeRate = getExchangeRateToJPY(currency);
  const earningsAfterFeeJpy =
    exchangeRate !== null ? earningsAfterFee * exchangeRate : null;
  const profitJpy =
    earningsAfterFeeJpy !== null
      ? earningsAfterFeeJpy - shippingCostJpy - costPriceJpy
      : null;
  const profitMargin =
    earningsAfterFeeJpy && earningsAfterFeeJpy !== 0
      ? (profitJpy / earningsAfterFeeJpy) * 100
      : null;
  const researcherIncentive =
    profitJpy && profitJpy > 0 ? profitJpy * INCENTIVE_RATE : 0;

  return {
    currency,
    totalAmount,
    earnings,
    earningsAfterFee,
    shippingCostJpy,
    costPriceJpy,
    earningsAfterFeeJpy,
    profitJpy,
    profitMargin,
    researcherIncentive,
    exchangeRateApplied: exchangeRate !== null,
  };
};

exports.fetchOrdersWithFilters = async (filters, isCSVDownload = false) => {
  const { start_date, end_date, user_id, ebay_user_id, status, buyer_country_code, researcher, page = 1, limit = 20 } = filters;

  const offset = (page - 1) * limit;

  // データ取得クエリ
  let query = supabase
      .from('orders')
      .select(`
          id,
          order_no,
          order_date,
          total_amount,
          earnings,
          earnings_after_pl_fee,
          shipping_cost,
          subtotal,
          status,
          buyer_country_code,
          researcher,
          order_line_items (*),
          ebay_user_id
      `)
      .eq('user_id', user_id)
      .neq('status', 'FULLY_REFUNDED') // FULLY_REFUNDEDステータスを除外
      .gte('order_date', start_date)
      .lte('order_date', end_date)
      .order('order_date', { ascending: true }); // order_dateで昇順に並び替え

  if (ebay_user_id) query = query.eq('ebay_user_id', ebay_user_id);
  if (status) query = query.eq('status', status);
  if (buyer_country_code) query = query.eq('buyer_country_code', buyer_country_code);
  if (researcher) query = query.eq('researcher', researcher);
  if (!isCSVDownload) query = query.range(offset, offset + limit - 1); // 通常のデータ取得時のみページングを適用

  const { data, error } = await query;

  if (error) {
      console.error('Error fetching orders:', error.message);
      throw error;
  }

  const normalizedOrders = (data || []).map(attachNormalizedLineItemsToOrder);

  const ordersWithProfit = normalizedOrders.map(order => {
      const financials = calculateOrderFinancials(order);
      return {
          ...order,
          calculated_currency: financials.currency,
          calculated_profit_jpy: financials.profitJpy,
          calculated_profit_margin: financials.profitMargin,
          calculated_cost_price_jpy: financials.costPriceJpy,
          calculated_shipping_cost_jpy: financials.shippingCostJpy,
          calculated_earnings_after_fee_jpy: financials.earningsAfterFeeJpy,
          calculated_exchange_rate_applied: financials.exchangeRateApplied,
          researcherIncentive: financials.researcherIncentive,
      };
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
  if (researcher) countQuery = countQuery.eq('researcher', researcher);

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
    .select('id, total_amount, earnings, earnings_after_pl_fee, subtotal, shipping_cost, researcher, order_line_items(*)')
    .eq('user_id', user_id)
    .neq('status', 'FULLY_REFUNDED')
    .gte('order_date', start_date)
    .lte('order_date', end_date);

  if (ebay_user_id) query = query.eq('ebay_user_id', ebay_user_id);
  if (status) query = query.eq('status', status);
  if (buyer_country_code) query = query.eq('buyer_country_code', buyer_country_code);
  if (researcher) query = query.eq('researcher', researcher);

  const { data, error } = await query;
  if (error) throw error;

  const normalizedOrders = (data || []).map(attachNormalizedLineItemsToOrder);

  const summarySeed = {
    totalOrders: 0,
    totalSalesByCurrency: {},
    totalEarningsByCurrency: {},
    totalEarningsAfterFeeByCurrency: {},
    subtotalByCurrency: {},
    totalShippingCostJpy: 0,
    totalCostPriceJpy: 0,
    totalProfitJpy: 0,
    earningsAfterFeeConvertedJpy: 0,
    profitSupportedCurrencies: new Set(),
    missingExchangeRates: new Set(),
    researcherIncentives: {},
  };

  const summary = normalizedOrders.reduce((acc, order) => {
    const financials = calculateOrderFinancials(order);
    acc.totalOrders += 1;

    addAmountByCurrency(acc.totalSalesByCurrency, financials.currency, financials.totalAmount);
    addAmountByCurrency(acc.totalEarningsByCurrency, financials.currency, financials.earnings);
    addAmountByCurrency(acc.totalEarningsAfterFeeByCurrency, financials.currency, financials.earningsAfterFee);
    addAmountByCurrency(acc.subtotalByCurrency, financials.currency, order.subtotal);

    acc.totalShippingCostJpy += financials.shippingCostJpy;
    acc.totalCostPriceJpy += financials.costPriceJpy;

    if (financials.earningsAfterFeeJpy !== null) {
      acc.earningsAfterFeeConvertedJpy += financials.earningsAfterFeeJpy;
    }

    if (financials.profitJpy !== null) {
      acc.totalProfitJpy += financials.profitJpy;
      acc.profitSupportedCurrencies.add(financials.currency);
    } else {
      acc.missingExchangeRates.add(financials.currency);
    }

    if (order.researcher) {
      if (!acc.researcherIncentives[order.researcher]) {
        acc.researcherIncentives[order.researcher] = 0;
      }
      acc.researcherIncentives[order.researcher] += Math.max(financials.researcherIncentive, 0);
    }

    return acc;
  }, summarySeed);

  const profitMargin =
    summary.earningsAfterFeeConvertedJpy > 0
      ? (summary.totalProfitJpy / summary.earningsAfterFeeConvertedJpy) * 100
      : null;

  const totalSalesDefaultCurrency = summary.totalSalesByCurrency[DEFAULT_ORDER_CURRENCY] || 0;

  return {
    total_orders: summary.totalOrders,
    total_sales: totalSalesDefaultCurrency,
    total_sales_by_currency: summary.totalSalesByCurrency,
    total_shipping_cost_jpy: summary.totalShippingCostJpy,
    total_cost_price_jpy: summary.totalCostPriceJpy,
    total_earnings_by_currency: summary.totalEarningsByCurrency,
    total_earnings_after_fee_by_currency: summary.totalEarningsAfterFeeByCurrency,
    total_profit_jpy: summary.totalProfitJpy,
    profit_margin: profitMargin,
    subtotal_by_currency: summary.subtotalByCurrency,
    earnings_after_fee_converted_jpy: summary.earningsAfterFeeConvertedJpy,
    profit_supported_currencies: Array.from(summary.profitSupportedCurrencies),
    profit_missing_exchange_rates: Array.from(summary.missingExchangeRates).filter(
      (currency) => !summary.profitSupportedCurrencies.has(currency)
    ),
    researcher_incentives: summary.researcherIncentives,
  };
};



// csvダウンロード機能
exports.downloadOrderSummaryCSV = async (filters) => {
  const allOrdersFilters = { ...filters, page: undefined, limit: undefined };
  const ordersData = await this.fetchOrdersWithFilters(allOrdersFilters, true);
  const summaryData = await this.fetchOrderSummary(filters);

  // summaryDataをフォーマット
  const summaryRows = [
    { label: 'Total Orders', value: summaryData.total_orders },
    { label: 'Total Profit (JPY)', value: summaryData.total_profit_jpy },
    { label: 'Profit Margin (%)', value: summaryData.profit_margin },
    { label: 'Converted Earnings After Fee (JPY)', value: summaryData.earnings_after_fee_converted_jpy },
    { label: 'Total Shipping Cost (JPY)', value: summaryData.total_shipping_cost_jpy },
    { label: 'Total Cost Price (JPY)', value: summaryData.total_cost_price_jpy },
  ];

  Object.entries(summaryData.total_sales_by_currency || {}).forEach(([currency, amount]) => {
    summaryRows.push({ label: `Total Sales (${currency})`, value: amount });
  });
  Object.entries(summaryData.total_earnings_by_currency || {}).forEach(([currency, amount]) => {
    summaryRows.push({ label: `Total Earnings (${currency})`, value: amount });
  });
  Object.entries(summaryData.total_earnings_after_fee_by_currency || {}).forEach(([currency, amount]) => {
    summaryRows.push({ label: `Total Earnings After Fee (${currency})`, value: amount });
  });
  Object.entries(summaryData.subtotal_by_currency || {}).forEach(([currency, amount]) => {
    summaryRows.push({ label: `Subtotal (${currency})`, value: amount });
  });
  if (summaryData.profit_missing_exchange_rates?.length) {
    summaryRows.push({
      label: 'Profit Missing Exchange Rates',
      value: summaryData.profit_missing_exchange_rates.join(', '),
    });
  }
  Object.entries(summaryData.researcher_incentives || {}).forEach(([researcher, incentive]) => {
    summaryRows.push({ label: `Incentive for ${researcher}`, value: incentive });
  });

  // expandedOrdersを作成
  const expandedOrders = ordersData.orders.flatMap(order => {
    let lastResearcher = null;
    return order.line_items.map((item, index) => {
      const isDifferentResearcher = item.researcher !== lastResearcher;
      lastResearcher = item.researcher;
      return {
        order_no: order.order_no,
        order_date: order.order_date,
        item: item.title,
        quantity: item.quantity,
        price: index === 0 ? order.earnings : '',
        net_total: index === 0 ? order.earnings_after_pl_fee : '',
        cost_price: item.cost_price,
        shipping_cost: index === 0 ? order.shipping_cost : '',
        status: index === 0 ? order.status : '',
        buyer_country_code: index === 0 ? order.buyer_country_code : '',
        researcher: item.researcher || order.researcher,
        researcherIncentive: isDifferentResearcher ? order.researcherIncentive : ''
      };
    });
  });

  // summaryRowsとexpandedOrdersを結合
  const combinedData = [
    ...summaryRows.map(row => ({ [row.label]: row.value })),
    {},
    ...expandedOrders
  ];

  // Summary部分を手動でCSV形式に変換
  const summaryCsv = summaryRows.map(row => `${row.label},${row.value}`).join('\n');

  const csvFields = [
    { label: 'Order No', value: 'order_no' },
    { label: 'Date', value: 'order_date' },
    { label: 'Item', value: 'item' },
    { label: 'Qty', value: 'quantity' },
    { label: 'Price', value: 'price' },
    { label: 'Net Total', value: 'net_total' },
    { label: 'Cost Price', value: 'cost_price' },
    { label: 'Shipping Cost', value: 'shipping_cost' },
    { label: 'Status', value: 'status' },
    { label: 'Buyer Country', value: 'buyer_country_code' },
    { label: 'Researcher', value: 'researcher' },
    { label: 'Incentive', value: 'researcherIncentive' }
  ];

  const csvParser = new Parser({ fields: csvFields });
  const csvData = csvParser.parse(expandedOrders);

  // summaryCsvとcsvDataを結合
  const finalCsvData = `${summaryCsv}\n\n${csvData}`;

  return finalCsvData;
};
