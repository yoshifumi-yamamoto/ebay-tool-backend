const supabase = require('../supabaseClient');

const TIME_ZONE_EBAY = 'America/Los_Angeles';

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

async function fetchTodayMetrics({ userId, fromDay, toDay }) {
  if (!userId || !fromDay || !toDay) {
    throw new Error('userId, fromDay and toDay are required');
  }

  const { fromTs, toTs } = ebayDayToUtcRange(fromDay, toDay);

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
      'shipping_status',
      'shipco_synced_at',
      'order_date',
    ].join(','))
    .eq('user_id', userId)
    .gte('order_date', fromTs.toISOString())
    .lt('order_date', toTs.toISOString());

  if (ordersError) {
    throw new Error(`Failed to fetch orders: ${ordersError.message}`);
  }

  const activityOrders = orders || [];
  const grossSales = activityOrders.reduce((acc, order) => {
    const subtotal = toNumber(order.subtotal);
    const total = toNumber(order.total_amount);
    return acc + (subtotal > 0 ? subtotal : total);
  }, 0);
  const ordersCount = activityOrders.length;
  const estShippingTotal = sumField(activityOrders, 'estimated_shipping_cost');
  const estDdpTotal = 0;

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
    return acc
      + (toNumber(order.subtotal) || toNumber(order.total_amount))
      - toNumber(order.cost_price)
      - (toNumber(order.final_shipping_cost) || toNumber(order.shipco_shipping_cost))
      - 0;
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
      gross_sales: grossSales,
      orders: ordersCount,
      aov: ordersCount > 0 ? grossSales / ordersCount : 0,
    },
    lane_a: {
      new_orders: ordersCount,
      gross_sales: grossSales,
      est_shipping_total: estShippingTotal,
      est_ddp_total: estDdpTotal,
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
    },
    risk: {
      refund_amount: sumField(refunds || [], 'amount'),
      refund_count: (refunds || []).length,
      return_request_count: (returns || []).length,
    },
  };
}

module.exports = {
  fetchTodayMetrics,
  ebayDayToUtcRange,
};
