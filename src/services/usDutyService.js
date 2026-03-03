const supabase = require('../supabaseClient');

const US_DUTY_RATE = 0.15;

const toNumber = (value) => {
  if (value === undefined || value === null || value === '') {
    return 0;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const normalizeCurrencyCode = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.toUpperCase() : null;
};

const loadExchangeRatesForUser = async (userId) => {
  const rates = {
    USD: Number(process.env.EXCHANGE_RATE_USD_TO_JPY) || 145,
    EUR: Number(process.env.EXCHANGE_RATE_EUR_TO_JPY) || null,
    CAD: Number(process.env.EXCHANGE_RATE_CAD_TO_JPY) || null,
    GBP: Number(process.env.EXCHANGE_RATE_GBP_TO_JPY) || null,
    AUD: Number(process.env.EXCHANGE_RATE_AUD_TO_JPY) || null,
    JPY: 1,
  };
  const targetUserId = userId || 2;
  const { data, error } = await supabase
    .from('users')
    .select('usd_rate, eur_rate, cad_rate, gbp_rate, aud_rate')
    .eq('id', targetUserId)
    .single();
  if (!error && data) {
    const mapping = {
      usd_rate: 'USD',
      eur_rate: 'EUR',
      cad_rate: 'CAD',
      gbp_rate: 'GBP',
      aud_rate: 'AUD',
    };
    Object.entries(mapping).forEach(([column, currency]) => {
      const value = data[column];
      if (value === undefined || value === null) return;
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        rates[currency] = numeric;
      }
    });
  }
  return rates;
};

const convertAmountToJpy = (amount, currency, exchangeRates) => {
  if (amount === null || amount === undefined) {
    return null;
  }
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const key = normalizeCurrencyCode(currency) || 'JPY';
  const rateToJpy = exchangeRates[key];
  if (!Number.isFinite(rateToJpy)) {
    return null;
  }
  return numeric * rateToJpy;
};

async function fetchUsDutyOrders(userId, filters = {}) {
  const limit = Number.isFinite(Number(filters.limit)) ? Math.min(Number(filters.limit), 200) : 50;
  const page = Number.isFinite(Number(filters.page)) ? Math.max(Number(filters.page), 0) : 0;
  const offset = page * limit;
  const orderNoFilter = filters.order_no ? String(filters.order_no).trim() : '';
  const ebayUserFilter = filters.ebay_user_id ? String(filters.ebay_user_id).trim() : '';
  const trackingNumberFilter = filters.tracking_number ? String(filters.tracking_number).trim() : '';
  const dutyStatusFilter = filters.duty_status ? String(filters.duty_status).trim().toLowerCase() : 'all';
  const fromDateFilter = filters.from_date ? String(filters.from_date).trim() : '';
  const toDateFilter = filters.to_date ? String(filters.to_date).trim() : '';
  const needsConfirmedFilter = dutyStatusFilter === 'confirmed' || dutyStatusFilter === 'unconfirmed';

  let query = supabase
    .from('orders')
    .select([
      'id',
      'order_no',
      'order_date',
      'ebay_user_id',
      'ebay_buyer_id',
      'buyer_country_code',
      'total_amount',
      'subtotal',
      'total_amount_currency',
      'subtotal_currency',
      'earnings',
      'earnings_currency',
      'status',
      'shipping_tracking_number',
      'order_line_items(title,item_image)',
      'line_items',
    ].join(','), { count: needsConfirmedFilter ? undefined : 'exact' })
    .eq('user_id', userId)
    .eq('buyer_country_code', 'US')
    .order('order_date', { ascending: false });

  if (orderNoFilter) {
    query = query.ilike('order_no', `%${orderNoFilter}%`);
  }
  if (ebayUserFilter) {
    query = query.ilike('ebay_user_id', `%${ebayUserFilter}%`);
  }
  if (trackingNumberFilter) {
    query = query.ilike('shipping_tracking_number', `%${trackingNumberFilter}%`);
  }
  if (fromDateFilter) {
    query = query.gte('order_date', `${fromDateFilter}T00:00:00`);
  }
  if (toDateFilter) {
    query = query.lte('order_date', `${toDateFilter}T23:59:59`);
  }
  if (!needsConfirmedFilter) {
    query = query.range(offset, offset + limit - 1);
  }

  const { data, error, count } = await query;
  if (error) {
    throw new Error(`Failed to fetch US duty orders: ${error.message}`);
  }
  const exchangeRates = await loadExchangeRatesForUser(userId);
  const rows = data || [];
  const trackingNumbers = Array.from(
    new Set(rows.map((order) => order.shipping_tracking_number).filter(Boolean))
  );
  let customsTotalByAwb = {};
  let feeTaxTotalByAwb = {};
  let feeInclTaxTotalByAwb = {};
  let carrierByAwb = {};
  if (trackingNumbers.length > 0) {
    const { data: totals, error: totalsError } = await supabase
      .from('v_carrier_awb_totals')
      .select('awb_number, carrier, actual_customs_amount, actual_fee_tax_amount, actual_fee_amount_incl_tax')
      .in('awb_number', trackingNumbers);
    if (!totalsError && Array.isArray(totals)) {
      customsTotalByAwb = totals.reduce((acc, row) => {
        if (!row?.awb_number) return acc;
        acc[row.awb_number] = toNumber(row.actual_customs_amount);
        return acc;
      }, {});
      feeTaxTotalByAwb = totals.reduce((acc, row) => {
        if (!row?.awb_number) return acc;
        acc[row.awb_number] = toNumber(row.actual_fee_tax_amount);
        return acc;
      }, {});
      feeInclTaxTotalByAwb = totals.reduce((acc, row) => {
        if (!row?.awb_number) return acc;
        acc[row.awb_number] = toNumber(row.actual_fee_amount_incl_tax);
        return acc;
      }, {});
      carrierByAwb = totals.reduce((acc, row) => {
        if (!row?.awb_number) return acc;
        const carrier = typeof row.carrier === 'string' ? row.carrier.trim() : '';
        if (carrier) {
          acc[row.awb_number] = carrier;
        }
        return acc;
      }, {});
    }
  }
  const mapped = rows.map((order) => {
    const totalAmount = toNumber(order.total_amount) || toNumber(order.subtotal);
    const totalCurrency =
      normalizeCurrencyCode(order.total_amount_currency) ||
      normalizeCurrencyCode(order.subtotal_currency) ||
      'USD';
    const dutyBaseJpy = convertAmountToJpy(totalAmount, totalCurrency, exchangeRates);
    const dutyJpy = dutyBaseJpy !== null ? dutyBaseJpy * US_DUTY_RATE : null;
    const lineItems = Array.isArray(order.order_line_items) && order.order_line_items.length
      ? order.order_line_items
      : Array.isArray(order.line_items)
        ? order.line_items
        : [];
    const first = lineItems[0] || {};
    const trackingNumber = order.shipping_tracking_number || null;
    return {
      ...order,
      duty_jpy: dutyJpy,
      shipping_carrier: trackingNumber ? carrierByAwb[trackingNumber] ?? null : null,
      confirmed_duty_jpy: trackingNumber ? customsTotalByAwb[trackingNumber] ?? null : null,
      confirmed_fee_tax_jpy: trackingNumber ? feeTaxTotalByAwb[trackingNumber] ?? null : null,
      confirmed_fee_incl_tax_jpy: trackingNumber ? feeInclTaxTotalByAwb[trackingNumber] ?? null : null,
      item_title: first.title || first.item_title || null,
      item_image: first.item_image || first.itemImage || null,
    };
  });
  if (!needsConfirmedFilter) {
    return { orders: mapped, total: count || 0 };
  }

  const filtered = mapped.filter((order) => {
    const confirmedDuty = Number(order.confirmed_duty_jpy);
    const isConfirmed = Number.isFinite(confirmedDuty) && confirmedDuty > 0;
    if (dutyStatusFilter === 'confirmed') {
      return isConfirmed;
    }
    if (dutyStatusFilter === 'unconfirmed') {
      return !isConfirmed;
    }
    return true;
  });
  const paged = filtered.slice(offset, offset + limit);
  return { orders: paged, total: filtered.length };
}

module.exports = {
  fetchUsDutyOrders,
};
