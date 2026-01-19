const supabase = require('../supabaseClient');

const TIME_ZONE_EBAY = 'America/Los_Angeles';
const DEFAULT_DASHBOARD_CURRENCY = 'USD';
const FEE_RATE = 0.21;
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

const toNumber = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

const getTimeZoneOffsetMinutes = (date, timeZone) => {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});
  const utcTime = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return (utcTime - date.getTime()) / 60000;
};

const ebayDayToUtcRange = (fromDay, toDay) => {
  const [fromYear, fromMonth, fromDate] = fromDay.split('-').map(Number);
  const [toYear, toMonth, toDate] = toDay.split('-').map(Number);

  const fromUtc = new Date(Date.UTC(fromYear, fromMonth - 1, fromDate, 0, 0, 0));
  const fromOffset = getTimeZoneOffsetMinutes(fromUtc, TIME_ZONE_EBAY);
  const fromTs = new Date(fromUtc.getTime() - fromOffset * 60000);

  const toUtc = new Date(Date.UTC(toYear, toMonth - 1, toDate + 1, 0, 0, 0));
  const toOffset = getTimeZoneOffsetMinutes(toUtc, TIME_ZONE_EBAY);
  const toTs = new Date(toUtc.getTime() - toOffset * 60000);

  return { fromTs, toTs };
};

const sumField = (rows, field) => rows.reduce((acc, row) => acc + toNumber(row[field]), 0);
const sumLineItemCostPrice = (lineItems = []) =>
  lineItems.reduce((acc, item) => acc + toNumber(item?.cost_price), 0);

const addAmountByCurrency = (bucket, currency, amount) => {
  const numeric = toNumber(amount);
  if (!Number.isFinite(numeric) || numeric === 0) {
    return;
  }
  const key = normalizeCurrencyCode(currency) || DEFAULT_DASHBOARD_CURRENCY;
  bucket[key] = (bucket[key] || 0) + numeric;
};

const loadExchangeRatesForUser = async (userId) => {
  const rates = { ...ENV_EXCHANGE_RATES, JPY: 1 };
  const targetUserId = userId || 2;
  try {
    const { data, error } = await supabase
      .from('users')
      .select('usd_rate, eur_rate, cad_rate, gbp_rate, aud_rate')
      .eq('id', targetUserId)
      .single();
    if (error || !data) {
      if (error) {
        console.error('Failed to load user exchange rates:', error.message);
      }
      return rates;
    }
    const mapping = {
      usd_rate: 'USD',
      eur_rate: 'EUR',
      cad_rate: 'CAD',
      gbp_rate: 'GBP',
      aud_rate: 'AUD',
    };
    Object.entries(mapping).forEach(([column, currency]) => {
      const raw = data[column];
      const numeric = raw === null || raw === undefined ? null : Number(raw);
      if (Number.isFinite(numeric) && numeric > 0) {
        rates[currency] = numeric;
      }
    });
  } catch (err) {
    console.error('Unexpected error while loading exchange rates:', err);
  }
  return rates;
};

const convertAmountToUsd = (amount, currency, exchangeRates) => {
  const numeric = toNumber(amount);
  if (!Number.isFinite(numeric) || numeric === 0) {
    return 0;
  }
  const normalized = normalizeCurrencyCode(currency) || DEFAULT_DASHBOARD_CURRENCY;
  if (normalized === 'USD') {
    return numeric;
  }
  const usdRate = exchangeRates.USD;
  if (!usdRate) {
    return null;
  }
  if (normalized === 'JPY') {
    return numeric / usdRate;
  }
  const rateToJpy = exchangeRates[normalized];
  if (!rateToJpy) {
    return null;
  }
  return (numeric * rateToJpy) / usdRate;
};

const convertAmountToJpy = (amount, currency, exchangeRates) => {
  const numeric = toNumber(amount);
  if (!Number.isFinite(numeric) || numeric === 0) {
    return 0;
  }
  const normalized = normalizeCurrencyCode(currency) || DEFAULT_DASHBOARD_CURRENCY;
  if (normalized === 'JPY') {
    return numeric;
  }
  const rateToJpy = exchangeRates[normalized];
  if (!rateToJpy) {
    return null;
  }
  return numeric * rateToJpy;
};

async function fetchTodayMetrics({ userId, fromDay, toDay }) {
  if (!userId || !fromDay || !toDay) {
    throw new Error('userId, fromDay and toDay are required');
  }

  const exchangeRates = await loadExchangeRatesForUser(userId);
  const { fromTs, toTs } = ebayDayToUtcRange(fromDay, toDay);
  const excludedStatuses = new Set(['CANCELED', 'FULLY_REFUNDED']);

  const { data: orders, error: ordersError } = await supabase
    .from('orders')
    .select([
      'id',
      'subtotal',
      'total_amount',
      'cost_price',
      'estimated_shipping_cost',
      'shipco_shipping_cost',
      'final_shipping_cost',
      'status',
      'shipping_status',
      'shipco_synced_at',
      'order_date',
      'order_no',
      'buyer_country_code',
      'image_url',
      'line_items',
      'order_line_items(title,item_image,cost_price)',
      'subtotal_currency',
      'total_amount_currency',
      'earnings',
      'earnings_currency',
      'earnings_after_pl_fee',
      'earnings_after_pl_fee_currency',
    ].join(','))
    .eq('user_id', userId)
    .gte('order_date', fromTs.toISOString())
    .lt('order_date', toTs.toISOString());

  if (ordersError) {
    throw new Error(`Failed to fetch orders: ${ordersError.message}`);
  }

  const rawOrders = orders || [];
  const activityOrders = rawOrders.filter((order) => !excludedStatuses.has(order.status));
  const resolveCurrency = (order) => order.subtotal_currency || order.total_amount_currency || null;
  const defaultCurrency =
    activityOrders.find((order) => resolveCurrency(order))?.subtotal_currency ||
    activityOrders.find((order) => resolveCurrency(order))?.total_amount_currency ||
    DEFAULT_DASHBOARD_CURRENCY;
  const grossSalesByCurrency = {};
  const earningsAfterFeeByCurrency = {};
  const ordersByCurrency = {};
  const missingExchangeRates = new Set();
  let grossSalesUsd = 0;
  let earningsAfterFeeUsd = 0;
  let ordersConvertedCount = 0;

  const extractTitleFromLineItems = (lineItems) => {
    if (!lineItems) return null;
    const items = Array.isArray(lineItems) ? lineItems : [lineItems];
    for (const item of items) {
      const title =
        item?.title ||
        item?.item_title ||
        item?.itemTitle ||
        item?.name ||
        item?.item?.title ||
        null;
      if (title) return title;
    }
    return null;
  };

  const extractImageFromLineItems = (lineItems) => {
    if (!lineItems) return null;
    const items = Array.isArray(lineItems) ? lineItems : [lineItems];
    for (const item of items) {
      const direct =
        item?.item_image ||
        item?.itemImage ||
        item?.image_url ||
        item?.imageUrl ||
        item?.primary_image_url ||
        null;
      if (typeof direct === 'string' && direct.trim()) {
        return direct;
      }
      const nested =
        item?.itemImage?.imageUrl ||
        item?.itemImage?.url ||
        item?.image?.imageUrl ||
        item?.image?.url ||
        null;
      if (typeof nested === 'string' && nested.trim()) {
        return nested;
      }
    }
    return null;
  };

  const getOrderLineItems = (order) => {
    if (Array.isArray(order?.order_line_items) && order.order_line_items.length) {
      return order.order_line_items;
    }
    return order?.line_items || [];
  };

  const resolveEarningsCurrency = (order) =>
    normalizeCurrencyCode(order.earnings_after_pl_fee_currency)
    || normalizeCurrencyCode(order.earnings_currency)
    || normalizeCurrencyCode(order.subtotal_currency)
    || normalizeCurrencyCode(order.total_amount_currency)
    || DEFAULT_DASHBOARD_CURRENCY;

  let earningsAfterFeeJpyTotal = 0;
  let profitJpyTotal = 0;
  let profitRateBaseJpyTotal = 0;

  const orderDetails = activityOrders.map((order) => {
    const lineItems = getOrderLineItems(order);
    const costPriceFallback = sumLineItemCostPrice(lineItems);
    const price = toNumber(order.total_amount) || toNumber(order.subtotal);
    const currencyRaw = resolveCurrency(order) || defaultCurrency;
    const currency = normalizeCurrencyCode(currencyRaw) || DEFAULT_DASHBOARD_CURRENCY;
    const earningsAfterFee = toNumber(order.earnings_after_pl_fee) || toNumber(order.earnings);
    const earningsCurrency = resolveEarningsCurrency(order);
    const priceUsd = convertAmountToUsd(price, currency, exchangeRates);
    const earningsAfterFeeUsdForFee = convertAmountToUsd(
      earningsAfterFee,
      earningsCurrency,
      exchangeRates
    );
    const feeRateOrder =
      priceUsd !== null && priceUsd > 0 && earningsAfterFeeUsdForFee !== null
        ? ((priceUsd - earningsAfterFeeUsdForFee) / priceUsd) * 100
        : null;
    const totalAmount = toNumber(order.total_amount) || toNumber(order.subtotal);
    const totalAmountCurrency =
      normalizeCurrencyCode(order.total_amount_currency) ||
      normalizeCurrencyCode(order.subtotal_currency) ||
      currency;
    const dutyBaseJpy = convertAmountToJpy(totalAmount, totalAmountCurrency, exchangeRates);
    const dutyJpy =
      order.buyer_country_code === 'US' && dutyBaseJpy !== null
        ? dutyBaseJpy * US_DUTY_RATE
        : 0;
    const earningsAfterFeeJpy = convertAmountToJpy(earningsAfterFee, earningsCurrency, exchangeRates);
    const shippingCostJpy =
      toNumber(order.final_shipping_cost) ||
      toNumber(order.shipco_shipping_cost) ||
      toNumber(order.estimated_shipping_cost);
    const costPriceJpy = toNumber(order.cost_price) || costPriceFallback;
    const profitJpy =
      earningsAfterFeeJpy !== null
        ? earningsAfterFeeJpy - dutyJpy - shippingCostJpy - costPriceJpy
        : null;
    const profitRate =
      earningsAfterFeeJpy && earningsAfterFeeJpy !== 0 && profitJpy !== null
        ? (profitJpy / earningsAfterFeeJpy) * 100
        : null;
    addAmountByCurrency(grossSalesByCurrency, currency, price);
    addAmountByCurrency(earningsAfterFeeByCurrency, earningsCurrency, earningsAfterFee);
    ordersByCurrency[currency] = (ordersByCurrency[currency] || 0) + 1;
    const converted = convertAmountToUsd(price, currency, exchangeRates);
    if (converted === null) {
      missingExchangeRates.add(currency);
    } else {
      grossSalesUsd += converted;
      ordersConvertedCount += 1;
    }
    if (earningsAfterFee > 0) {
      const convertedEarnings = convertAmountToUsd(earningsAfterFee, earningsCurrency, exchangeRates);
      if (convertedEarnings === null) {
        missingExchangeRates.add(earningsCurrency);
      } else {
        earningsAfterFeeUsd += convertedEarnings;
      }
    }
    if (earningsAfterFeeJpy !== null) {
      earningsAfterFeeJpyTotal += earningsAfterFeeJpy;
      profitRateBaseJpyTotal += earningsAfterFeeJpy;
    }
    if (profitJpy !== null) {
      profitJpyTotal += profitJpy;
    }
    return {
      order_no: order.order_no || null,
      title: extractTitleFromLineItems(lineItems),
      image_url: order.image_url || extractImageFromLineItems(lineItems) || null,
      price,
      price_currency: currency,
      earnings_after_fee: earningsAfterFee,
      earnings_after_fee_currency: earningsCurrency,
      fee_rate: feeRateOrder,
      cost_price: toNumber(order.cost_price) || costPriceFallback,
      estimated_shipping_cost: toNumber(order.estimated_shipping_cost),
      duty_jpy: dutyJpy,
      profit_jpy: profitJpy,
      profit_rate: profitRate,
      buyer_country_code: order.buyer_country_code || null,
      status: order.status || null,
    };
  });

  const ordersCount = activityOrders.length;
  const estShippingTotal = sumField(activityOrders, 'estimated_shipping_cost');
  const estDdpTotal = 0;
  const grossSalesUsdValue = grossSalesUsd;
  const earningsAfterFeeUsdValue = earningsAfterFeeUsd;
  const aovUsd = ordersConvertedCount > 0 ? grossSalesUsdValue / ordersConvertedCount : 0;
  const feeRate = grossSalesUsdValue > 0
    ? (grossSalesUsdValue - earningsAfterFeeUsdValue) / grossSalesUsdValue
    : 0;
  const profitRateTotal =
    profitRateBaseJpyTotal > 0 ? (profitJpyTotal / profitRateBaseJpyTotal) * 100 : 0;
  const aovByCurrency = Object.entries(grossSalesByCurrency).reduce((acc, [currency, amount]) => {
    const count = ordersByCurrency[currency] || 0;
    acc[currency] = count > 0 ? amount / count : 0;
    return acc;
  }, {});

  const shippingConfirmedOrders = activityOrders.filter((order) => {
    const value = order.shipco_synced_at;
    if (!value) return false;
    const ts = new Date(value);
    return ts >= fromTs && ts < toTs;
  });
  const shippingConfirmedAmount = shippingConfirmedOrders.reduce((acc, order) => {
    const actual = toNumber(order.final_shipping_cost) || toNumber(order.shipco_shipping_cost);
    if (actual > 0) return acc + actual;
    return acc + toNumber(order.estimated_shipping_cost);
  }, 0);

  const ddpConfirmedOrders = [];
  const ddpConfirmedAmount = 0;

  const settledOrders = activityOrders.filter((order) => {
    if (order.shipping_status !== 'SHIPPED') return false;
    const value = order.shipco_synced_at || order.order_date;
    if (!value) return false;
    const ts = new Date(value);
    return ts >= fromTs && ts < toTs;
  });
  const settledProfit = settledOrders.reduce((acc, order) => {
    const earningsAfterFee = toNumber(order.earnings_after_pl_fee) || toNumber(order.earnings);
    const earningsCurrency = resolveEarningsCurrency(order);
    const earningsJpy = convertAmountToJpy(earningsAfterFee, earningsCurrency, exchangeRates);
    if (earningsJpy === null) {
      missingExchangeRates.add(earningsCurrency);
      return acc;
    }
    const dutyBase = toNumber(order.total_amount) || toNumber(order.subtotal);
    const dutyCurrency =
      normalizeCurrencyCode(order.total_amount_currency) ||
      normalizeCurrencyCode(order.subtotal_currency) ||
      normalizeCurrencyCode(resolveCurrency(order) || defaultCurrency) ||
      DEFAULT_DASHBOARD_CURRENCY;
    const dutyBaseJpy = convertAmountToJpy(dutyBase, dutyCurrency, exchangeRates);
    if (dutyBaseJpy === null) {
      missingExchangeRates.add(dutyCurrency);
      return acc;
    }
    const dutyJpy = order.buyer_country_code === 'US' ? dutyBaseJpy * US_DUTY_RATE : 0;
    return (
      acc +
      earningsJpy -
      dutyJpy -
      toNumber(order.cost_price) -
      (toNumber(order.final_shipping_cost) || toNumber(order.shipco_shipping_cost)) -
      0
    );
  }, 0);

  let refunds = [];
  let returns = [];
  const { data: refundsData, error: refundsError } = await supabase
    .from('refunds')
    .select('amount, refund_at, orders!inner(user_id)')
    .eq('orders.user_id', userId)
    .gte('refund_at', fromTs.toISOString())
    .lt('refund_at', toTs.toISOString());
  if (!refundsError) {
    refunds = refundsData || [];
  }

  const { data: returnsData, error: returnsError } = await supabase
    .from('returns')
    .select('id, requested_at, orders!inner(user_id)')
    .eq('orders.user_id', userId)
    .gte('requested_at', fromTs.toISOString())
    .lt('requested_at', toTs.toISOString());
  if (!returnsError) {
    returns = returnsData || [];
  }

  return {
    range: {
      from_day: fromDay,
      to_day: toDay,
      from_ts: fromTs.toISOString(),
      to_ts: toTs.toISOString(),
      time_zone: TIME_ZONE_EBAY,
    },
    activity: {
      gross_sales: grossSalesUsdValue,
      gross_sales_usd: grossSalesUsdValue,
      gross_sales_by_currency: grossSalesByCurrency,
      earnings_after_fee_usd: earningsAfterFeeUsdValue,
      earnings_after_fee_by_currency: earningsAfterFeeByCurrency,
      fee_rate: feeRate,
      profit_jpy: profitJpyTotal,
      profit_rate: profitRateTotal,
      exchange_rate_usd_jpy: exchangeRates.USD || null,
      orders: ordersCount,
      aov: aovUsd,
      aov_usd: aovUsd,
      aov_by_currency: aovByCurrency,
      currency: DEFAULT_DASHBOARD_CURRENCY,
      missing_exchange_rates: Array.from(missingExchangeRates),
    },
    lane_a: {
      new_orders: ordersCount,
      gross_sales: grossSalesUsdValue,
      gross_sales_usd: grossSalesUsdValue,
      gross_sales_by_currency: grossSalesByCurrency,
      est_shipping_total: estShippingTotal,
      est_ddp_total: estDdpTotal,
      currency: DEFAULT_DASHBOARD_CURRENCY,
    },
    lane_b: {
      shipping_confirmed: {
        count: shippingConfirmedOrders.length,
        amount: shippingConfirmedAmount,
      },
      ddp_confirmed: {
        count: ddpConfirmedOrders.length,
        amount: ddpConfirmedAmount,
      },
      newly_settled_orders: settledOrders.length,
      confirmed_profit: settledProfit,
      confirmed_profit_notes: {
        exchange_rate_usd_jpy: exchangeRates.USD || null,
        fee_rate: feeRate,
        us_duty_rate: US_DUTY_RATE,
        us_duty_applies_to: 'US',
      },
      currency: DEFAULT_DASHBOARD_CURRENCY,
    },
    risk: {
      refund_amount: sumField(refunds || [], 'amount'),
      refund_count: (refunds || []).length,
      return_request_count: (returns || []).length,
      currency: DEFAULT_DASHBOARD_CURRENCY,
    },
    order_details: orderDetails,
  };
}

module.exports = {
  fetchTodayMetrics,
  ebayDayToUtcRange,
};
