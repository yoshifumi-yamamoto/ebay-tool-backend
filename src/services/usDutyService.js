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
      'order_line_items(title,item_image)',
      'line_items',
    ].join(','), { count: 'exact' })
    .eq('user_id', userId)
    .eq('buyer_country_code', 'US')
    .order('order_date', { ascending: false })
    .range(offset, offset + limit - 1);

  if (orderNoFilter) {
    query = query.ilike('order_no', `%${orderNoFilter}%`);
  }
  if (ebayUserFilter) {
    query = query.ilike('ebay_user_id', `%${ebayUserFilter}%`);
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
  let shipmentIdByAwb = {};
  let customsTotalByAwb = {};
  if (trackingNumbers.length > 0) {
    const { data: shipments, error: shipmentsError } = await supabase
      .from('carrier_shipments')
      .select('id, awb_number')
      .in('awb_number', trackingNumbers);
    if (!shipmentsError && Array.isArray(shipments)) {
      shipmentIdByAwb = shipments.reduce((acc, row) => {
        if (row.awb_number) {
          acc[row.awb_number] = row.id;
        }
        return acc;
      }, {});
      const shipmentIds = shipments.map((row) => row.id).filter(Boolean);
      if (shipmentIds.length > 0) {
        const { data: charges, error: chargesError } = await supabase
          .from('carrier_charges')
          .select('shipment_id, amount, charge_group')
          .in('shipment_id', shipmentIds)
          .eq('charge_group', 'customs');
        if (!chargesError && Array.isArray(charges)) {
          const awbByShipmentId = shipments.reduce((acc, row) => {
            if (row.id && row.awb_number) {
              acc[row.id] = row.awb_number;
            }
            return acc;
          }, {});
          customsTotalByAwb = charges.reduce((acc, charge) => {
            const awb = awbByShipmentId[charge.shipment_id];
            if (!awb) return acc;
            acc[awb] = (acc[awb] || 0) + toNumber(charge.amount);
            return acc;
          }, {});
        }
      }
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
      confirmed_duty_jpy: trackingNumber ? customsTotalByAwb[trackingNumber] ?? null : null,
      item_title: first.title || first.item_title || null,
      item_image: first.item_image || first.itemImage || null,
    };
  });
  return { orders: mapped, total: count || 0 };
}

module.exports = {
  fetchUsDutyOrders,
};
