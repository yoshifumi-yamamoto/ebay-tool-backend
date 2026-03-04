const supabase = require('../supabaseClient');

const TIME_ZONE_EBAY = 'America/Los_Angeles';
const DEFAULT_DASHBOARD_CURRENCY = 'USD';
const FEE_RATE = 0.21;
const US_DUTY_RATE = 0.15;
const SHIPPING_DELTA_ALERT_JPY = Number(process.env.DASHBOARD_ALERT_SHIPPING_DELTA_JPY) || 2000;
const SHIPPING_DELTA_ALERT_RATE = Number(process.env.DASHBOARD_ALERT_SHIPPING_DELTA_RATE) || 0.3;
const DUTY_DELTA_ALERT_JPY = Number(process.env.DASHBOARD_ALERT_DUTY_DELTA_JPY) || 1000;
const DUTY_DELTA_ALERT_RATE = Number(process.env.DASHBOARD_ALERT_DUTY_DELTA_RATE) || 0.5;

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

  const orderSelectColumns = [
    'id',
    'subtotal',
    'total_amount',
    'cost_price',
    'estimated_shipping_cost',
    'shipco_shipping_cost',
    'final_shipping_cost',
    'shipping_tracking_number',
    'shipping_carrier',
    'status',
    'shipping_status',
    'shipco_synced_at',
    'shipment_recorded_at',
    'shipping_reconciled_at',
    'duty_reconciled_at',
    'order_date',
    'order_no',
    'ebay_user_id',
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
  ].join(',');

  const { data: orders, error: ordersError } = await supabase
    .from('orders')
    .select(orderSelectColumns)
    .eq('user_id', userId)
    .gte('order_date', fromTs.toISOString())
    .lt('order_date', toTs.toISOString());

  if (ordersError) {
    throw new Error(`Failed to fetch orders: ${ordersError.message}`);
  }

  // Shipment Profit Detail is based on shipment timing, so load that window separately.
  const { data: shipmentWindowOrders, error: shipmentWindowError } = await supabase
    .from('orders')
    .select(orderSelectColumns)
    .eq('user_id', userId)
    .eq('shipping_status', 'SHIPPED')
    .gte('shipment_recorded_at', fromTs.toISOString())
    .lt('shipment_recorded_at', toTs.toISOString());

  if (shipmentWindowError) {
    throw new Error(`Failed to fetch shipment window orders: ${shipmentWindowError.message}`);
  }

  const rawOrders = orders || [];
  const rawShipmentWindowOrders = shipmentWindowOrders || [];
  const activityOrders = rawOrders.filter((order) => !excludedStatuses.has(order.status));
  const shipmentActivityOrders = rawShipmentWindowOrders.filter(
    (order) => !excludedStatuses.has(order.status)
  );
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
      ebay_user_id: order.ebay_user_id || null,
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
    const value = order.shipping_reconciled_at;
    if (!value) return false;
    const ts = new Date(value);
    return ts >= fromTs && ts < toTs;
  });
  const shippingTrackingNumbers = Array.from(
    new Set(shippingConfirmedOrders.map((order) => order.shipping_tracking_number).filter(Boolean))
  );
  let customsTotalByAwb = {};
  let shippingTotalByAwb = {};
  let carrierByAwb = {};
  if (shippingTrackingNumbers.length > 0) {
    const { data: shipments, error: shipmentsError } = await supabase
      .from('carrier_shipments')
      .select('id, awb_number, invoice_id, created_at')
      .in('awb_number', shippingTrackingNumbers);
    if (!shipmentsError && Array.isArray(shipments)) {
      const latestShipmentByAwb = shipments.reduce((acc, row) => {
        if (!row?.awb_number) return acc;
        const existing = acc[row.awb_number];
        if (!existing) {
          acc[row.awb_number] = row;
          return acc;
        }
        const existingTime = existing.created_at ? new Date(existing.created_at).getTime() : 0;
        const rowTime = row.created_at ? new Date(row.created_at).getTime() : 0;
        if (rowTime >= existingTime) {
          acc[row.awb_number] = row;
        }
        return acc;
      }, {});
      const invoiceIds = Array.from(
        new Set(Object.values(latestShipmentByAwb).map((row) => row?.invoice_id).filter(Boolean))
      );
      if (invoiceIds.length > 0) {
        const { data: invoices, error: invoicesError } = await supabase
          .from('carrier_invoices')
          .select('id, carrier')
          .in('id', invoiceIds);
        if (!invoicesError && Array.isArray(invoices)) {
          const carrierByInvoiceId = invoices.reduce((acc, row) => {
            if (row?.id) acc[row.id] = row.carrier || null;
            return acc;
          }, {});
          carrierByAwb = Object.entries(latestShipmentByAwb).reduce((acc, [awb, row]) => {
            acc[awb] = carrierByInvoiceId[row.invoice_id] || null;
            return acc;
          }, {});
        }
      }
      const shipmentIds = shipments.map((row) => row.id).filter(Boolean);
      if (shipmentIds.length > 0) {
        const { data: charges, error: chargesError } = await supabase
          .from('carrier_charges')
          .select('shipment_id, amount, charge_group')
          .in('shipment_id', shipmentIds);
        if (!chargesError && Array.isArray(charges)) {
          const awbByShipmentId = shipments.reduce((acc, row) => {
            if (row.id && row.awb_number) {
              acc[row.id] = row.awb_number;
            }
            return acc;
          }, {});
          const totalsByAwb = charges.reduce((acc, charge) => {
            const awb = awbByShipmentId[charge.shipment_id];
            if (!awb) return acc;
            if (!acc[awb]) {
              acc[awb] = { customs: 0, shipping: 0 };
            }
            const amount = toNumber(charge.amount);
            if (charge.charge_group === 'customs') {
              acc[awb].customs += amount;
            } else {
              acc[awb].shipping += amount;
            }
            return acc;
          }, {});
          customsTotalByAwb = Object.entries(totalsByAwb).reduce((acc, [awb, totals]) => {
            acc[awb] = totals.customs;
            return acc;
          }, {});
          shippingTotalByAwb = Object.entries(totalsByAwb).reduce((acc, [awb, totals]) => {
            acc[awb] = totals.shipping;
            return acc;
          }, {});
        }
      }
    }
  }
  const shippingConfirmedAmount = shippingConfirmedOrders.reduce((acc, order) => {
    const fromInvoice = order.shipping_tracking_number
      ? toNumber(shippingTotalByAwb[order.shipping_tracking_number])
      : 0;
    const actual = fromInvoice || toNumber(order.final_shipping_cost) || toNumber(order.shipco_shipping_cost);
    if (actual > 0) return acc + actual;
    return acc + toNumber(order.estimated_shipping_cost);
  }, 0);
  const shippingConfirmedDetails = shippingConfirmedOrders.map((order) => {
    const totalAmount = toNumber(order.total_amount) || toNumber(order.subtotal);
    const totalCurrency =
      normalizeCurrencyCode(order.total_amount_currency) ||
      normalizeCurrencyCode(order.subtotal_currency) ||
      DEFAULT_DASHBOARD_CURRENCY;
    const dutyBaseJpy = convertAmountToJpy(totalAmount, totalCurrency, exchangeRates);
    const dutyEstimatedJpy =
      order.buyer_country_code === 'US' && dutyBaseJpy !== null ? dutyBaseJpy * US_DUTY_RATE : 0;
    const trackingNumber = order.shipping_tracking_number || null;
    const confirmedDutyJpy = trackingNumber ? customsTotalByAwb[trackingNumber] ?? null : null;
    const confirmedShippingJpy = trackingNumber ? toNumber(shippingTotalByAwb[trackingNumber]) : 0;
    const shippingActual =
      confirmedShippingJpy || toNumber(order.final_shipping_cost) || toNumber(order.shipco_shipping_cost) || 0;
    const shippingEstimated = toNumber(order.estimated_shipping_cost) || 0;
    const shippingDelta = shippingActual && shippingEstimated ? shippingActual - shippingEstimated : null;
    const dutyDelta =
      confirmedDutyJpy !== null && confirmedDutyJpy !== undefined
        ? confirmedDutyJpy - dutyEstimatedJpy
        : null;
    const shippingDeltaRate =
      shippingEstimated > 0 && shippingDelta !== null && shippingDelta !== undefined
        ? shippingDelta / shippingEstimated
        : null;
    const dutyDeltaRate =
      dutyEstimatedJpy > 0 && dutyDelta !== null && dutyDelta !== undefined
        ? dutyDelta / dutyEstimatedJpy
        : null;
    const hasLargeShippingDelta =
      shippingDelta !== null &&
      Math.abs(shippingDelta) >= SHIPPING_DELTA_ALERT_JPY &&
      (shippingDeltaRate === null || Math.abs(shippingDeltaRate) >= SHIPPING_DELTA_ALERT_RATE);
    const hasLargeDutyDelta =
      dutyDelta !== null &&
      Math.abs(dutyDelta) >= DUTY_DELTA_ALERT_JPY &&
      (dutyDeltaRate === null || Math.abs(dutyDeltaRate) >= DUTY_DELTA_ALERT_RATE);
    const hasNonUsCustoms =
      order.buyer_country_code &&
      String(order.buyer_country_code).toUpperCase() !== 'US' &&
      confirmedDutyJpy !== null &&
      confirmedDutyJpy > 0;
    const anomalyFlags = [
      hasLargeShippingDelta ? 'shipping_large_delta' : null,
      hasLargeDutyDelta ? 'duty_large_delta' : null,
      hasNonUsCustoms ? 'customs_non_us' : null,
    ].filter(Boolean);
    return {
      order_no: order.order_no || null,
      shipping_tracking_number: trackingNumber,
      buyer_country_code: order.buyer_country_code || null,
      shipping_actual_cost: shippingActual || null,
      shipping_estimated_cost: shippingEstimated || null,
      shipping_delta: shippingDelta,
      shipping_delta_rate: shippingDeltaRate,
      duty_estimated_jpy: dutyEstimatedJpy,
      duty_confirmed_jpy: confirmedDutyJpy,
      duty_delta_jpy: dutyDelta,
      duty_delta_rate: dutyDeltaRate,
      anomaly_flags: anomalyFlags,
    };
  });
  const shippingConfirmedSummary = shippingConfirmedDetails.reduce(
    (acc, row) => {
      acc.shipping_actual_total += toNumber(row.shipping_actual_cost);
      acc.shipping_estimated_total += toNumber(row.shipping_estimated_cost);
      acc.duty_estimated_total += toNumber(row.duty_estimated_jpy);
      if (row.duty_confirmed_jpy !== null && row.duty_confirmed_jpy !== undefined) {
        acc.duty_confirmed_total += toNumber(row.duty_confirmed_jpy);
      }
      return acc;
    },
    {
      shipping_actual_total: 0,
      shipping_estimated_total: 0,
      shipping_delta_total: 0,
      duty_estimated_total: 0,
      duty_confirmed_total: 0,
      duty_delta_total: 0,
    }
  );
  shippingConfirmedSummary.shipping_delta_total =
    toNumber(shippingConfirmedSummary.shipping_actual_total) -
    toNumber(shippingConfirmedSummary.shipping_estimated_total);
  shippingConfirmedSummary.duty_delta_total =
    toNumber(shippingConfirmedSummary.duty_confirmed_total) -
    toNumber(shippingConfirmedSummary.duty_estimated_total);

  const ddpConfirmedOrders = activityOrders.filter((order) => {
    const value = order.duty_reconciled_at;
    if (!value) return false;
    const ts = new Date(value);
    return ts >= fromTs && ts < toTs;
  });
  const ddpConfirmedAmount = ddpConfirmedOrders.reduce((acc, order) => {
    const trackingNumber = order.shipping_tracking_number || null;
    const confirmedDuty = trackingNumber ? toNumber(customsTotalByAwb[trackingNumber]) : 0;
    if (confirmedDuty > 0) {
      return acc + confirmedDuty;
    }
    return acc;
  }, 0);

  const settledOrders = shipmentActivityOrders.filter((order) => {
    if (order.shipping_status !== 'SHIPPED') return false;
    const value = order.shipment_recorded_at;
    if (!value) return false;
    const ts = new Date(value);
    return ts >= fromTs && ts < toTs;
  });
  const settledOrderProfitDetails = settledOrders.map((order) => {
    const totalAmount = toNumber(order.total_amount) || toNumber(order.subtotal);
    const totalCurrency =
      normalizeCurrencyCode(order.total_amount_currency) ||
      normalizeCurrencyCode(order.subtotal_currency) ||
      normalizeCurrencyCode(resolveCurrency(order) || defaultCurrency) ||
      DEFAULT_DASHBOARD_CURRENCY;
    const earningsAfterFee = toNumber(order.earnings_after_pl_fee) || toNumber(order.earnings);
    const earningsCurrency = resolveEarningsCurrency(order);
    const earningsJpy = convertAmountToJpy(earningsAfterFee, earningsCurrency, exchangeRates);
    const dutyBaseJpy = convertAmountToJpy(totalAmount, totalCurrency, exchangeRates);
    const dutyEstimatedJpy =
      order.buyer_country_code === 'US' && dutyBaseJpy !== null ? dutyBaseJpy * US_DUTY_RATE : 0;
    const estimatedShipping = toNumber(order.estimated_shipping_cost) || 0;
    const shipcoShipping = toNumber(order.shipco_shipping_cost) || 0;
    const finalShipping = toNumber(order.final_shipping_cost) || 0;
    const shippingUsed =
      toNumber(order.final_shipping_cost) ||
      toNumber(order.shipco_shipping_cost) ||
      toNumber(order.estimated_shipping_cost) ||
      0;
    const costJpy = toNumber(order.cost_price);
    const provisionalProfitJpy =
      earningsJpy === null ? null : earningsJpy - dutyEstimatedJpy - costJpy - shippingUsed;
    const provisionalProfitRate =
      earningsJpy !== null && earningsJpy > 0 && provisionalProfitJpy !== null
        ? (provisionalProfitJpy / earningsJpy) * 100
        : null;
    const shippingSource =
      toNumber(order.final_shipping_cost) > 0
        ? 'final'
        : toNumber(order.shipco_shipping_cost) > 0
          ? 'shipco'
          : toNumber(order.estimated_shipping_cost) > 0
            ? 'estimated'
            : 'none';
    const lineItems = getOrderLineItems(order);
    return {
      order_no: order.order_no || null,
      ebay_user_id: order.ebay_user_id || null,
      title: extractTitleFromLineItems(lineItems),
      image_url: order.image_url || extractImageFromLineItems(lineItems) || null,
      buyer_country_code: order.buyer_country_code || null,
      shipping_carrier:
        order.shipping_carrier ||
        (order.shipping_tracking_number ? carrierByAwb[order.shipping_tracking_number] || null : null),
      earnings_after_fee_jpy: earningsJpy,
      cost_jpy: costJpy,
      estimated_shipping_jpy: estimatedShipping,
      shipco_shipping_jpy: shipcoShipping,
      final_shipping_jpy: finalShipping,
      shipping_gap_shipco_vs_est_jpy: shipcoShipping - estimatedShipping,
      shipping_cost_jpy: shippingUsed,
      shipping_cost_source: shippingSource,
      duty_estimated_jpy: dutyEstimatedJpy,
      provisional_profit_jpy: provisionalProfitJpy,
      provisional_profit_rate: provisionalProfitRate,
    };
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
      shipping_confirmed_details: shippingConfirmedDetails,
      shipping_confirmed_summary: shippingConfirmedSummary,
      ddp_confirmed: {
        count: ddpConfirmedOrders.length,
        amount: ddpConfirmedAmount,
      },
      newly_settled_orders: settledOrders.length,
      shipment_profit_details: settledOrderProfitDetails,
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
