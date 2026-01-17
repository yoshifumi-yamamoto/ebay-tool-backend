const supabase = require('../supabaseClient');

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

const loadExchangeRatesForUser = async (userId) => {
  const rates = { ...ENV_EXCHANGE_RATES, JPY: 1 };
  if (!userId) {
    return rates;
  }
  try {
    const { data, error } = await supabase
      .from('users')
      .select('usd_rate, eur_rate, cad_rate, gbp_rate, aud_rate')
      .eq('id', userId)
      .single();
    if (error || !data) {
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
    console.error('Failed to load exchange rates:', err);
  }
  return rates;
};

const convertAmountToUsd = (amount, currency, exchangeRates) => {
  const numeric = toNumber(amount);
  if (!Number.isFinite(numeric) || numeric === 0) {
    return 0;
  }
  const normalized = normalizeCurrencyCode(currency) || 'USD';
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

const sumOrderAmountsUsd = (orders, exchangeRates) =>
  orders.reduce((acc, order) => {
    const amount = order.total_amount ?? order.subtotal ?? 0;
    const currency = order.total_amount_currency || order.subtotal_currency || 'USD';
    const converted = convertAmountToUsd(amount, currency, exchangeRates);
    if (converted === null) {
      return acc;
    }
    return acc + converted;
  }, 0);

const buildBuyerStats = (orders, exchangeRates) => {
  const now = Date.now();
  const windows = [
    { key: 'last_1_month', days: 30 },
    { key: 'last_3_months', days: 90 },
    { key: 'last_6_months', days: 180 },
    { key: 'last_12_months', days: 365 },
  ];
  const stats = {};
  windows.forEach((window) => {
    const threshold = now - window.days * 24 * 60 * 60 * 1000;
    const windowOrders = orders.filter((order) => {
      if (!order.order_date) return false;
      return new Date(order.order_date).getTime() >= threshold;
    });
    stats[window.key] = {
      order_count: windowOrders.length,
      amount_usd: sumOrderAmountsUsd(windowOrders, exchangeRates),
    };
  });
  return stats;
};

const getOrderHistoryByBuyer = async (ebayBuyerId, userId) => {
  const { data, error } = await supabase
    .from('orders')
    .select('id, order_no, order_date, total_amount, total_amount_currency, status')
    .eq('user_id', userId)
    .eq('ebay_buyer_id', ebayBuyerId)
    .order('order_date', { ascending: false });
  if (error) {
    throw new Error('Failed to fetch orders: ' + error.message);
  }
  return data || [];
};

// 既存のバイヤー情報を取得
async function getBuyersByUserId(userId) {
  const { data, error } = await supabase
      .from('buyers')
      .select('*')
      .eq('user_id', userId)
      .order('last_purchase_date', { ascending: false }); // 降順でソート
  if (error) throw new Error('Failed to retrieve buyers: ' + error.message);
  return data;
}

async function getBuyersByUserIdWithStats(userId) {
  const buyers = await getBuyersByUserId(userId);
  const exchangeRates = await loadExchangeRatesForUser(userId);

  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, ebay_buyer_id, order_date, total_amount, total_amount_currency, subtotal, subtotal_currency')
    .eq('user_id', userId);
  if (error) {
    throw new Error('Failed to fetch orders: ' + error.message);
  }

  const ordersByBuyer = (orders || []).reduce((acc, order) => {
    const key = order.ebay_buyer_id || 'unknown';
    if (!acc[key]) acc[key] = [];
    acc[key].push(order);
    return acc;
  }, {});

  return (buyers || []).map((buyer) => {
    const buyerOrders = ordersByBuyer[buyer.ebay_buyer_id] || [];
    const lastPurchase =
      buyerOrders.reduce((latest, order) => {
        if (!order.order_date) return latest;
        const ts = new Date(order.order_date).getTime();
        return ts > latest ? ts : latest;
      }, 0) || null;
    return {
      ...buyer,
      last_purchase_date: lastPurchase ? new Date(lastPurchase).toISOString() : buyer.last_purchase_date,
      purchase_stats: buildBuyerStats(buyerOrders, exchangeRates),
      total_order_count: buyerOrders.length,
      is_repeat_buyer: buyerOrders.length > 1,
    };
  });
}

async function getBuyerDetailWithOrders(buyerId, userId) {
  const { data: buyer, error } = await supabase
    .from('buyers')
    .select('*')
    .eq('id', buyerId)
    .single();
  if (error) {
    throw new Error('Failed to fetch buyer: ' + error.message);
  }
  if (!buyer) {
    throw new Error('Buyer not found');
  }
  const orders = await getOrderHistoryByBuyer(buyer.ebay_buyer_id, userId);
  const exchangeRates = await loadExchangeRatesForUser(userId);
  const lastPurchase =
    orders.reduce((latest, order) => {
      if (!order.order_date) return latest;
      const ts = new Date(order.order_date).getTime();
      return ts > latest ? ts : latest;
    }, 0) || null;
  const purchaseStats = buildBuyerStats(orders, exchangeRates);
  return {
    buyer: {
      ...buyer,
      last_purchase_date: lastPurchase ? new Date(lastPurchase).toISOString() : buyer.last_purchase_date,
      total_order_count: orders.length,
      is_repeat_buyer: orders.length > 1,
    },
    purchase_stats: purchaseStats,
    orders,
  };
}

async function updateBuyer (buyerId, buyerData) {
  const { data, error } = await supabase
      .from('buyers')
      .update(buyerData)
      .eq('id', buyerId);
  if (error) throw new Error('Failed to update buyer: ' + error.message);
  return data;
};

// 新しいバイヤーを作成または更新(ebayから)
async function upsertBuyer(buyerInfo) {
  // SupabaseにおけるUPSERT（挿入または更新）を試みる
  const { data, error } = await supabase
    .from('buyers')
    .upsert(buyerInfo, { onConflict: 'ebay_buyer_id', returning: 'representation' });

  if (error) {
    console.error('Failed to upsert buyer:', error.message, error.details);
    throw error;
  }

  // UPSERTした後のバイヤーデータを取得
  if (data && data.length > 0) {
    return data[0];
  } else {
    // UPSERTが成功してもデータが返ってこない場合は、明示的にデータを取得
    return await fetchBuyerByEbayId(buyerInfo.ebay_buyer_id);
  }
}


// ebay_buyer_idに基づいてバイヤー情報を取得
async function fetchBuyerByEbayId(ebayBuyerId) {
  const { data, error } = await supabase
    .from('buyers')
    .select('*')
    .eq('ebay_buyer_id', ebayBuyerId);

  if (error) {
    console.error('Failed to fetch buyer by ebay buyer id:', error.message, error.details);
    throw error;
  }

  if (data.length === 0) {
    // バイヤーが見つからない場合、新しいバイヤーを作成する
    return await createBuyer({ ebay_buyer_id: ebayBuyerId });
  } else if (data.length === 1) {
    // 期待通り1つのバイヤーが見つかった場合
    return data[0];
  } else {
    // 複数のバイヤーが見つかった場合、ログに出力して最初のバイヤーを選択
    console.warn('Multiple buyers found for the same eBay buyer ID, selecting the first.');
    return data[0];
  }
}



// 注文データとバイヤー情報を処理
async function processOrdersAndBuyers(orders) {
  for (let order of orders) {
    // バイヤー情報のアップサート（挿入または更新）
    const buyer = await upsertBuyer({
      ebay_buyer_id: order.buyer.username,
      name: order.buyer.buyerRegistrationAddress.fullName,
      // 注文データから取得するその他のバイヤー情報があればここに追加
      registered_date: new Date().toISOString() // 例: 登録日
    });

    // 注文データにバイヤーIDを追加して保存（別関数で実装）
    // saveOrderToSupabaseなどで実装
    // ...
  }
}

// 省略...

module.exports = {
  processOrdersAndBuyers,
  fetchBuyerByEbayId,
  getBuyersByUserId,
  getBuyersByUserIdWithStats,
  getBuyerDetailWithOrders,
  upsertBuyer,
  updateBuyer
};
