const { Parser } = require('json2csv');
const supabase = require('../supabaseClient');
const { attachNormalizedLineItemsToOrder } = require('./orderService');

const DEFAULT_ORDER_CURRENCY = 'USD';
const DEFAULT_PAYOUT_CURRENCY = 'USD';
const INCENTIVE_RATE = 0.1;
const US_DUTY_RATE = 0.15;

const ENV_EXCHANGE_RATES = {
  USD: Number(process.env.EXCHANGE_RATE_USD_TO_JPY) || 150,
  EUR: Number(process.env.EXCHANGE_RATE_EUR_TO_JPY) || null,
  CAD: Number(process.env.EXCHANGE_RATE_CAD_TO_JPY) || null,
  GBP: Number(process.env.EXCHANGE_RATE_GBP_TO_JPY) || null,
  AUD: Number(process.env.EXCHANGE_RATE_AUD_TO_JPY) || null,
  JPY: 1,
};

const normalizeCurrencyCode = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.toUpperCase() : null;
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

const getExchangeRateToJPY = (currency, exchangeRates) => {
  if (!currency) {
    return null;
  }
  const normalized = normalizeCurrencyCode(currency);
  const rate = exchangeRates[normalized];
  return typeof rate === 'number' && Number.isFinite(rate) ? rate : null;
};

const addAmountByCurrency = (bucket, currency, amount) => {
  const numericAmount = toNumber(amount);
  if (!Number.isFinite(numericAmount) || numericAmount === 0) {
    return;
  }
  const key = normalizeCurrencyCode(currency) || DEFAULT_ORDER_CURRENCY;
  bucket[key] = (bucket[key] || 0) + numericAmount;
};

const calculateOrderFinancials = (order, exchangeRates) => {
  const lineItems = order.line_items || [];
  const fallbackCurrency = getOrderCurrency(order);

  const totalAmount = toNumber(order.total_amount);
  const totalAmountCurrency =
    normalizeCurrencyCode(order.total_amount_currency) ||
    normalizeCurrencyCode(fallbackCurrency) ||
    DEFAULT_ORDER_CURRENCY;

  const subtotal = toNumber(order.subtotal);
  const subtotalCurrency =
    normalizeCurrencyCode(order.subtotal_currency) || totalAmountCurrency;

  const earnings = toNumber(order.earnings);
  const earningsCurrency =
    normalizeCurrencyCode(order.earnings_currency) || DEFAULT_PAYOUT_CURRENCY;

  const earningsAfterFee = toNumber(order.earnings_after_pl_fee);
  const earningsAfterFeeCurrency =
    normalizeCurrencyCode(order.earnings_after_pl_fee_currency) || earningsCurrency;

  const shippingCostJpy = toNumber(order.estimated_shipping_cost);
  const costPriceJpy = sumCostPrice(lineItems);
  const exchangeRate = getExchangeRateToJPY(earningsAfterFeeCurrency, exchangeRates);
  const earningsAfterFeeJpy =
    exchangeRate !== null ? earningsAfterFee * exchangeRate : null;
  const totalAmountRate = getExchangeRateToJPY(totalAmountCurrency, exchangeRates);
  const dutyBaseJpy =
    totalAmountRate !== null ? totalAmount * totalAmountRate : null;
  const dutyJpy =
    order.buyer_country_code === 'US' && dutyBaseJpy !== null
      ? dutyBaseJpy * US_DUTY_RATE
      : 0;
  const profitJpy =
    earningsAfterFeeJpy !== null
      ? earningsAfterFeeJpy - dutyJpy - shippingCostJpy - costPriceJpy
      : null;
  const profitMargin =
    earningsAfterFeeJpy && earningsAfterFeeJpy !== 0
      ? (profitJpy / earningsAfterFeeJpy) * 100
      : null;
  const researcherIncentive =
    profitJpy && profitJpy > 0 ? profitJpy * INCENTIVE_RATE : 0;

  return {
    totalAmount,
    totalAmountCurrency,
    subtotal,
    subtotalCurrency,
    earnings,
    earningsCurrency,
    earningsAfterFee,
    earningsAfterFeeCurrency,
    shippingCostJpy,
    costPriceJpy,
    dutyJpy,
    earningsAfterFeeJpy,
    profitJpy,
    profitMargin,
    researcherIncentive,
    exchangeRateApplied: exchangeRate !== null,
    exchangeRateCurrency: earningsAfterFeeCurrency,
  };
};

const loadExchangeRatesForUser = async (userId) => {
  const normalizedRates = { ...ENV_EXCHANGE_RATES };
  normalizedRates.JPY = 1;

  if (!userId) {
    return normalizedRates;
  }

  try {
    const { data, error } = await supabase
      .from('users')
      .select('usd_rate, eur_rate, cad_rate, gbp_rate, aud_rate')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Failed to load user exchange rates:', error.message);
      return normalizedRates;
    }

    if (!data) {
      return normalizedRates;
    }

    const mapping = {
      usd_rate: 'USD',
      eur_rate: 'EUR',
      cad_rate: 'CAD',
      gbp_rate: 'GBP',
      aud_rate: 'AUD',
    };

    Object.entries(mapping).forEach(([column, currency]) => {
      const value = data[column];
      if (value === undefined || value === null) {
        return;
      }
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        normalizedRates[currency] = numeric;
      }
    });

    return normalizedRates;
  } catch (err) {
    console.error('Unexpected error while loading exchange rates:', err);
    return normalizedRates;
  }
};

exports.fetchOrdersWithFilters = async (filters, isCSVDownload = false) => {
  const { start_date, end_date, user_id, ebay_user_id, status, buyer_country_code, researcher, page = 1, limit = 20 } = filters;

  const offset = (page - 1) * limit;

  const exchangeRates = await loadExchangeRatesForUser(user_id);

  // データ取得クエリ
  let query = supabase
      .from('orders')
      .select(`
          id,
          order_no,
          order_date,
          total_amount,
          total_amount_currency,
          earnings,
          earnings_currency,
          earnings_after_pl_fee,
          earnings_after_pl_fee_currency,
          estimated_shipping_cost,
          subtotal,
          subtotal_currency,
          status,
          buyer_country_code,
          researcher,
          order_line_items (*),
          ebay_user_id
      `)
      .eq('user_id', user_id)
      .neq('status', 'FULLY_REFUNDED') // FULLY_REFUNDEDステータスを除外
      .neq('status', 'CANCELED')
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
      const financials = calculateOrderFinancials(order, exchangeRates);
      return {
          ...order,
          calculated_currency: financials.totalAmountCurrency,
          calculated_total_amount_currency: financials.totalAmountCurrency,
          calculated_subtotal_currency: financials.subtotalCurrency,
          calculated_earnings_currency: financials.earningsCurrency,
          calculated_earnings_after_fee_currency: financials.earningsAfterFeeCurrency,
          calculated_profit_jpy: financials.profitJpy,
          calculated_profit_margin: financials.profitMargin,
          calculated_cost_price_jpy: financials.costPriceJpy,
          calculated_shipping_cost_jpy: financials.shippingCostJpy,
          calculated_duty_jpy: financials.dutyJpy,
          calculated_earnings_after_fee_jpy: financials.earningsAfterFeeJpy,
          calculated_exchange_rate_applied: financials.exchangeRateApplied,
          calculated_exchange_rate_currency: financials.exchangeRateCurrency,
          researcherIncentive: financials.researcherIncentive,
      };
  });

  // 総注文数取得クエリ
  let countQuery = supabase
      .from('orders')
      .select('id', { count: 'exact' })
      .eq('user_id', user_id)
      .neq('status', 'FULLY_REFUNDED') // FULLY_REFUNDEDステータスを除外
      .neq('status', 'CANCELED')
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
    .select('id, total_amount, total_amount_currency, earnings, earnings_currency, earnings_after_pl_fee, earnings_after_pl_fee_currency, subtotal, subtotal_currency, estimated_shipping_cost, researcher, order_line_items(*)')
    .eq('user_id', user_id)
    .neq('status', 'FULLY_REFUNDED')
    .neq('status', 'CANCELED')
    .gte('order_date', start_date)
    .lte('order_date', end_date);

  if (ebay_user_id) query = query.eq('ebay_user_id', ebay_user_id);
  if (status) query = query.eq('status', status);
  if (buyer_country_code) query = query.eq('buyer_country_code', buyer_country_code);
  if (researcher) query = query.eq('researcher', researcher);

  const { data, error } = await query;
  if (error) throw error;

  const normalizedOrders = (data || []).map(attachNormalizedLineItemsToOrder);

  const exchangeRates = await loadExchangeRatesForUser(user_id);

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
    const financials = calculateOrderFinancials(order, exchangeRates);
    acc.totalOrders += 1;

    addAmountByCurrency(acc.totalSalesByCurrency, financials.totalAmountCurrency, financials.totalAmount);
    addAmountByCurrency(acc.totalEarningsByCurrency, financials.earningsCurrency, financials.earnings);
    addAmountByCurrency(acc.totalEarningsAfterFeeByCurrency, financials.earningsAfterFeeCurrency, financials.earningsAfterFee);
    addAmountByCurrency(acc.subtotalByCurrency, financials.subtotalCurrency, financials.subtotal);

    acc.totalShippingCostJpy += financials.shippingCostJpy;
    acc.totalCostPriceJpy += financials.costPriceJpy;

    if (financials.earningsAfterFeeJpy !== null) {
      acc.earningsAfterFeeConvertedJpy += financials.earningsAfterFeeJpy;
    }

    if (financials.profitJpy !== null) {
      acc.totalProfitJpy += financials.profitJpy;
      acc.profitSupportedCurrencies.add(financials.earningsAfterFeeCurrency);
    } else {
      acc.missingExchangeRates.add(financials.earningsAfterFeeCurrency);
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
      (currency) => currency && !summary.profitSupportedCurrencies.has(currency)
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
        shipping_cost: index === 0 ? order.estimated_shipping_cost : '',
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
