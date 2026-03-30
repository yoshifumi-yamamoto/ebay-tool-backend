const supabase = require('../supabaseClient');
const dayjs = require('dayjs');
const { attachNormalizedLineItemsToOrder } = require('./orderService');
const { getRefreshTokenByEbayUserId, refreshEbayToken } = require('./accountService');
const { fetchItemDetails } = require('./itemService');
const { fetchActiveListings } = require('./itemService');
const axios = require('axios');
const xml2js = require('xml2js');
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
    .select('ebay_item_id, ebay_user_id, sku, item_title, stocking_url, cost_price, estimated_shipping_cost, current_price_value, current_price_currency, primary_image_url')
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

  const rows = Array.isArray(data) ? data : [];

  if (ebay_item_id) {
    const enrichedRows = await Promise.all(
      rows.map(async (row) => {
        if (!row?.ebay_item_id || !row?.ebay_user_id) {
          return row;
        }
        try {
          const refreshToken = await getRefreshTokenByEbayUserId(row.ebay_user_id);
          const accessToken = await refreshEbayToken(refreshToken);
          const item = await fetchItemDetails(row.ebay_item_id, accessToken);
          if (!item) {
            return row;
          }
          const signals = getEbayItemSignals(item, row.ebay_item_id);
          return {
            ...row,
            current_price_value: signals.current_price_value ?? row.current_price_value,
            current_price_currency: signals.current_price_currency || row.current_price_currency,
            view_item_url: signals.view_item_url || null,
            site_code: signals.site_code || null,
            is_us_listing: signals.is_us_listing,
          };
        } catch (apiError) {
          console.warn('[item-search] failed to enrich item via eBay API:', row.ebay_item_id, apiError.message);
          return row;
        }
      })
    );
    return { items: enrichedRows.filter((row) => row?.is_us_listing === true) };
  }

  return { items: rows };
}

const normalizeSearchText = (value) => String(value || '')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim();

const titleToLikePattern = (value) => normalizeSearchText(value).replace(/\s+/g, '%');
const countSearchTerms = (value) => normalizeSearchText(value).split(' ').filter(Boolean).length;
const COMMON_SEARCH_TOKENS = new Set(['the', 'and', 'for', 'with', 'from', 'auto', 'scale']);
const NON_ENGLISH_HINT_TOKENS = new Set([
  'teclado', 'mecanico', 'mecánico', 'negro', 'blanco', 'rojo', 'azul', 'verde',
  'cable', 'usado', 'probado', 'teclas', 'raton', 'ratón', 'con', 'sin',
  'clavier', 'souris', 'noir', 'blanc', 'rouge', 'gris', 'avec', 'sans', 'occasion',
  'tastatur', 'maus', 'schwarz', 'weiss', 'weiß', 'gebraucht', 'getestet', 'mit', 'ohne',
]);
const SEARCH_TITLE_STOPWORDS = new Set([
  'keyboard', 'mechanical', 'wired', 'wireless', 'black', 'white', 'red', 'blue', 'green',
  'used', 'tested', 'test', 'working', 'gaming', 'teclado', 'mecanico', 'mecánico', 'negro',
  'blanco', 'rojo', 'azul', 'verde', 'cable', 'usado', 'probado', 'teclas', 'con', 'sin',
  'clavier', 'souris', 'noir', 'rouge', 'gris', 'avec', 'sans', 'occasion',
  'tastatur', 'maus', 'schwarz', 'weiss', 'weiß', 'gebraucht', 'getestet', 'mit', 'ohne',
]);
const SEARCH_TITLE_REPLACEMENTS = [
  [/\bteclado mec[aá]nico\b/gu, 'keyboard'],
  [/\bteclado\b/gu, 'keyboard'],
  [/\bmec[aá]nico\b/gu, 'mechanical'],
  [/\bcon cable\b/gu, 'wired'],
  [/\bcableado\b/gu, 'wired'],
  [/\bnegro\b/gu, 'black'],
  [/\bblanco\b/gu, 'white'],
  [/\brojo\b/gu, 'red'],
  [/\bazul\b/gu, 'blue'],
  [/\bverde\b/gu, 'green'],
  [/\busado\b/gu, 'used'],
  [/\bprobado\b/gu, 'tested'],
  [/\bclavier\b/gu, 'keyboard'],
  [/\bsouris\b/gu, 'mouse'],
  [/\bavec fil\b/gu, 'wired'],
  [/\bnoir\b/gu, 'black'],
  [/\bblanc\b/gu, 'white'],
  [/\brouge\b/gu, 'red'],
  [/\bgris\b/gu, 'gray'],
  [/\boccasion\b/gu, 'used'],
  [/\btastatur\b/gu, 'keyboard'],
  [/\bmaus\b/gu, 'mouse'],
  [/\bmit kabel\b/gu, 'wired'],
  [/\bschwarz\b/gu, 'black'],
  [/\bwei(?:ss|ß)\b/gu, 'white'],
  [/\bgebraucht\b/gu, 'used'],
  [/\bgetestet\b/gu, 'tested'],
];

const extractSearchTokens = (value) => {
  const normalized = normalizeSearchText(value);
  const rawTokens = normalized
    .split(' ')
    .map((token) => token.replace(/[^\p{L}\p{N}\-]/gu, ''))
    .filter(Boolean);

  const uniqueTokens = [];
  rawTokens.forEach((token) => {
    if (token.length < 3) return;
    if (COMMON_SEARCH_TOKENS.has(token)) return;
    if (uniqueTokens.includes(token)) return;
    uniqueTokens.push(token);
  });
  return uniqueTokens.slice(0, 5);
};

const isLikelyNonEnglishTitle = (value) => {
  const normalized = normalizeSearchText(value);
  if (!normalized) return false;
  const tokens = normalized
    .split(' ')
    .map((token) => token.replace(/[^\p{L}\p{N}\-]/gu, ''))
    .filter(Boolean);
  if (!tokens.length) return false;
  return tokens.some((token) => NON_ENGLISH_HINT_TOKENS.has(token));
};

const buildSupplementalSeedTitles = (value) => {
  const normalized = normalizeSearchText(value);
  if (!normalized || !isLikelyNonEnglishTitle(normalized)) {
    return [];
  }

  let translated = normalized;
  SEARCH_TITLE_REPLACEMENTS.forEach(([pattern, replacement]) => {
    translated = translated.replace(pattern, replacement);
  });
  translated = translated.replace(/[^\p{L}\p{N}\- ]/gu, ' ').replace(/\s+/g, ' ').trim();

  const translatedTokens = translated
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean);

  const filteredTokens = translatedTokens.filter((token) => {
    if (SEARCH_TITLE_STOPWORDS.has(token)) return false;
    if (token.length <= 1) return false;
    return /[\p{L}\p{N}]/u.test(token);
  });

  const uniqueFilteredTokens = [];
  filteredTokens.forEach((token) => {
    if (!uniqueFilteredTokens.includes(token)) {
      uniqueFilteredTokens.push(token);
    }
  });

  const titles = [];
  if (uniqueFilteredTokens.length >= 2) {
    titles.push(uniqueFilteredTokens.join(' '));
  }

  const modelTokens = uniqueFilteredTokens.filter((token) => /\d/.test(token) || /[a-z]/i.test(token));
  if (modelTokens.length >= 2) {
    const compactModelTitle = modelTokens.slice(0, 4).join(' ');
    if (compactModelTitle && !titles.includes(compactModelTitle)) {
      titles.push(compactModelTitle);
    }
  }

  return titles.slice(0, 3);
};

const applyTokenFilters = (query, column, tokens) => {
  let nextQuery = query;
  tokens.forEach((token) => {
    nextQuery = nextQuery.ilike(column, `%${token}%`);
  });
  return nextQuery;
};

const looksLikeUrl = (value) => /^https?:\/\//i.test(String(value || '').trim());

const buildUsEbayItemUrl = (itemId) => {
  const normalizedItemId = String(itemId || '').trim();
  return normalizedItemId ? `https://www.ebay.com/itm/${normalizedItemId}` : null;
};

const normalizeEbayViewUrlToUs = (url, itemId) => {
  const fallbackUrl = buildUsEbayItemUrl(itemId);
  if (!looksLikeUrl(url)) {
    return fallbackUrl;
  }
  try {
    const parsed = new URL(url);
    if (!/ebay\./i.test(parsed.hostname)) {
      return url;
    }
    return fallbackUrl || url;
  } catch (_error) {
    return fallbackUrl || url;
  }
};

const getTextValue = (value) => {
  if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, '_')) {
    return value._;
  }
  return value ?? null;
};

const getEbayItemSignals = (item, itemId) => {
  const currentPrice = item?.StartPrice || item?.SellingStatus?.CurrentPrice || null;
  const currentPriceValue = getTextValue(currentPrice);
  const currentPriceCurrency = currentPrice?.$?.currencyID || null;
  const siteCode = getTextValue(item?.Site);
  const rawViewItemUrl =
    getTextValue(item?.ListingDetails?.ViewItemURL) ||
    getTextValue(item?.ListingDetails?.ViewItemURLForNaturalSearch) ||
    null;
  const normalizedViewItemUrl = normalizeEbayViewUrlToUs(rawViewItemUrl, itemId);
  const isUsListing = String(siteCode || '').toUpperCase() === 'US' && String(currentPriceCurrency || '').toUpperCase() === 'USD';

  return {
    site_code: siteCode || null,
    current_price_value: currentPriceValue,
    current_price_currency: currentPriceCurrency,
    view_item_url: normalizedViewItemUrl,
    is_us_listing: isUsListing,
  };
};

const titleMatchesTokens = (title, tokens) => {
  const normalized = normalizeSearchText(title);
  return tokens.every((token) => normalized.includes(token));
};

let cachedBrowseApplicationToken = null;
let cachedBrowseApplicationTokenExpiresAt = 0;

async function getEbayBrowseApplicationToken() {
  if (cachedBrowseApplicationToken && Date.now() < cachedBrowseApplicationTokenExpiresAt) {
    return cachedBrowseApplicationToken;
  }

  let queryString;
  try {
    queryString = (await import('query-string')).default;
  } catch (error) {
    throw new Error(`Failed to import query-string: ${error.message}`);
  }

  const response = await axios.post(
    'https://api.ebay.com/identity/v1/oauth2/token',
    queryString.stringify({
      grant_type: 'client_credentials',
      scope: 'https://api.ebay.com/oauth/api_scope',
    }),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${process.env.EBAY_APP_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString('base64')}`,
      },
      timeout: 8000,
    }
  );

  const accessToken = response?.data?.access_token || null;
  const expiresIn = Number(response?.data?.expires_in || 7200);
  if (!accessToken) {
    throw new Error('Failed to obtain eBay Browse application token');
  }

  cachedBrowseApplicationToken = accessToken;
  cachedBrowseApplicationTokenExpiresAt = Date.now() + Math.max((expiresIn - 300) * 1000, 60 * 1000);
  return cachedBrowseApplicationToken;
}

const buildMarketplaceSearchQueries = (seedTitle) => {
  const queries = [];
  const pushQuery = (tokens) => {
    const normalizedTokens = Array.isArray(tokens) ? tokens.filter(Boolean) : [String(tokens || '').trim()].filter(Boolean);
    if (normalizedTokens.length === 0) return;
    const query = normalizedTokens.join(' ').trim();
    if (!query) return;
    if (queries.includes(query)) return;
    queries.push(query);
  };

  pushQuery(String(seedTitle || '').trim());

  const searchTokens = extractSearchTokens(seedTitle);
  if (searchTokens.length === 0) {
    return queries;
  }

  pushQuery(searchTokens.slice(0, 5));
  pushQuery(searchTokens.slice(0, 4));
  pushQuery(searchTokens.slice(0, 3));

  const modelTokens = searchTokens.filter((token) => /\d/.test(token) || token.includes('-'));
  pushQuery(modelTokens.slice(0, 3));
  pushQuery([searchTokens[0], ...modelTokens.slice(0, 2)]);

  return queries.slice(0, 5);
};

async function searchUsMarketplaceByTitle(seedTitle, limit = 10) {
  const keywords = String(seedTitle || '').trim();
  if (!keywords) return [];
  const searchTokens = extractSearchTokens(keywords);
  if (searchTokens.length === 0) return [];
  const queryCandidates = buildMarketplaceSearchQueries(keywords);
  let lastError = null;
  const applicationToken = await getEbayBrowseApplicationToken();

  for (const queryText of queryCandidates) {
    try {
      const response = await axios.get('https://api.ebay.com/buy/browse/v1/item_summary/search', {
        params: {
          q: queryText,
          limit: String(Math.min(Math.max(limit * 3, 20), 50)),
          filter: 'buyingOptions:{FIXED_PRICE}',
        },
        headers: {
          Authorization: `Bearer ${applicationToken}`,
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        },
        timeout: 8000,
      });

      const items = response?.data?.itemSummaries || [];

      const normalizedItems = (Array.isArray(items) ? items : [])
        .map((item) => ({
          ebay_item_id: item?.legacyItemId || null,
          ebay_user_id: 'EBAY_US',
          sku: null,
          item_title: item?.title || null,
          stocking_url: null,
          cost_price: null,
          estimated_shipping_cost: null,
          current_price_value: item?.price?.value || null,
          current_price_currency: item?.price?.currency || null,
          primary_image_url: item?.image?.imageUrl || null,
          updated_at: null,
          supplier_url: item?.itemWebUrl || null,
          site_code: item?.listingMarketplaceId === 'EBAY_US' ? 'US' : item?.listingMarketplaceId || null,
          is_us_listing:
            String(item?.listingMarketplaceId || '').toUpperCase() === 'EBAY_US' &&
            String(item?.price?.currency || '').toUpperCase() === 'USD',
        }))
        .filter((item) => item.is_us_listing && titleMatchesTokens(item.item_title, searchTokens))
        .slice(0, limit);

      if (normalizedItems.length > 0) {
        return normalizedItems;
      }
    } catch (error) {
      lastError = error;
      console.warn('[item-search] marketplace query failed', {
        queryText,
        message: error.message,
        status: error.response?.status || null,
        response: error.response?.data || null,
      });
    }
  }

  if (lastError) {
    throw lastError;
  }

  return [];
}

async function fetchEbayListingSeedsWithAccessToken(accessToken, seedTitle, maxPages = 30) {
  const tokens = extractSearchTokens(seedTitle);
  if (tokens.length < 2) {
    return [];
  }

  const matches = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const { listings = [], hasMoreItems = false } = await fetchActiveListings(accessToken, page, 100);
    const filtered = listings.filter((listing) => titleMatchesTokens(listing.item_title, tokens));
    matches.push(...filtered);
    if (matches.length >= 50) {
      break;
    }
    if (!hasMoreItems) {
      break;
    }
  }

  const deduped = new Map();
  matches.forEach((listing) => {
    const key = listing.legacyItemId || listing.item_title;
    if (!key || deduped.has(key)) return;
    deduped.set(key, listing);
  });
  return Array.from(deduped.values()).slice(0, 50);
}

async function fetchEbayListingSeeds(account, seedTitle, maxPages = 30) {
  const refreshToken = await getRefreshTokenByEbayUserId(account);
  const accessToken = await refreshEbayToken(refreshToken);
  return fetchEbayListingSeedsWithAccessToken(accessToken, seedTitle, maxPages);
}

async function fetchSellerListingsByTitleWithAccessToken(accessToken, seedTitle, maxPages = 20) {
  const tokens = extractSearchTokens(seedTitle);
  if (tokens.length < 2) {
    return [];
  }

  const startTimeFrom = new Date('2018-01-01T00:00:00.000Z').toISOString();
  const endTimeTo = new Date().toISOString();
  const parser = new xml2js.Parser({ explicitArray: false });
  const matches = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const requestBody = `<?xml version="1.0" encoding="utf-8"?>
<GetSellerListRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${accessToken}</eBayAuthToken>
  </RequesterCredentials>
  <StartTimeFrom>${startTimeFrom}</StartTimeFrom>
  <StartTimeTo>${endTimeTo}</StartTimeTo>
  <Pagination>
    <EntriesPerPage>100</EntriesPerPage>
    <PageNumber>${page}</PageNumber>
  </Pagination>
  <DetailLevel>ReturnAll</DetailLevel>
</GetSellerListRequest>`;

    const response = await axios.post('https://api.ebay.com/ws/api.dll', requestBody, {
      headers: {
        'Content-Type': 'text/xml',
        'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
        'X-EBAY-API-DEV-NAME': process.env.EBAY_DEV_ID,
        'X-EBAY-API-APP-NAME': process.env.EBAY_APP_ID,
        'X-EBAY-API-CERT-NAME': process.env.EBAY_CERT_ID,
        'X-EBAY-API-CALL-NAME': 'GetSellerList',
        'X-EBAY-API-SITEID': '0',
      },
    });

    const result = await parser.parseStringPromise(response.data);
    const responseRoot = result?.GetSellerListResponse || {};
    const itemRoot = responseRoot?.ItemArray?.Item || [];
    const items = Array.isArray(itemRoot) ? itemRoot : (itemRoot ? [itemRoot] : []);
    const totalEntries = Number.parseInt(responseRoot?.PaginationResult?.TotalNumberOfEntries || '0', 10) || 0;

    items.forEach((item) => {
      const title = item?.Title || null;
      if (!titleMatchesTokens(title, tokens)) return;
      const currentPrice = item?.StartPrice || item?.SellingStatus?.CurrentPrice || null;
      const currentPriceValue = getTextValue(currentPrice);
      const currentPriceCurrency = currentPrice?.$?.currencyID || null;
      const siteCode = getTextValue(item?.Site);
      matches.push({
        legacyItemId: item?.ItemID || null,
        item_title: title,
        sku: item?.SKU || null,
        primary_image_url: Array.isArray(item?.PictureDetails?.PictureURL)
          ? item.PictureDetails.PictureURL[0]
          : item?.PictureDetails?.PictureURL || null,
        current_price_value: currentPriceValue,
        current_price_currency: currentPriceCurrency,
        site_code: siteCode || null,
        is_us_listing:
          String(siteCode || '').toUpperCase() === 'US' &&
          String(currentPriceCurrency || '').toUpperCase() === 'USD',
        view_item_url: normalizeEbayViewUrlToUs(
          item?.ListingDetails?.ViewItemURL || item?.ListingDetails?.ViewItemURLForNaturalSearch || null,
          item?.ItemID || null
        ),
      });
    });

    if (matches.length >= 50) {
      break;
    }
    if ((page * 100) >= totalEntries) {
      break;
    }
  }

  const deduped = new Map();
  matches.forEach((listing) => {
    const key = listing.legacyItemId || listing.item_title;
    if (!key || deduped.has(key)) return;
    deduped.set(key, listing);
  });
  return Array.from(deduped.values()).slice(0, 50);
}

async function fetchSellerListingsByTitle(account, seedTitle, maxPages = 20) {
  const refreshToken = await getRefreshTokenByEbayUserId(account);
  const accessToken = await refreshEbayToken(refreshToken);
  return fetchSellerListingsByTitleWithAccessToken(accessToken, seedTitle, maxPages);
}

async function fetchDirectEbayItemCandidate(account, itemId) {
  if (!account || !itemId) {
    return null;
  }
  const refreshToken = await getRefreshTokenByEbayUserId(account);
  const accessToken = await refreshEbayToken(refreshToken);
  const item = await fetchItemDetails(itemId, accessToken);
  if (!item) {
    return null;
  }

  const rawPictures = item?.PictureDetails?.PictureURL;
  const primaryImage = Array.isArray(rawPictures) ? rawPictures[0] : rawPictures || null;
  const sku = item?.SKU || null;
  const signals = getEbayItemSignals(item, itemId);

  return {
    ebay_item_id: itemId,
    ebay_user_id: account,
    sku,
    item_title: item?.Title || null,
    stocking_url: null,
    cost_price: null,
    estimated_shipping_cost: null,
    current_price_value: signals.current_price_value,
    current_price_currency: signals.current_price_currency,
    primary_image_url: primaryImage,
    updated_at: null,
    supplier_url: looksLikeUrl(sku) ? sku : (signals.is_us_listing ? signals.view_item_url : null),
    view_item_url: signals.view_item_url,
    site_code: signals.site_code,
    is_us_listing: signals.is_us_listing,
  };
}

async function fetchInventoryItemBySku(ebayUserId, sku) {
  const refreshToken = await getRefreshTokenByEbayUserId(ebayUserId);
  const accessToken = await refreshEbayToken(refreshToken);
  const response = await axios.get(
    `https://api.ebay.com/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );
  return response.data || null;
}

async function resolveLookupSeeds({ user_id, account, title, sku, itemId }) {
  const seeds = [];
  const pushSeed = (seedTitle, source, sourceValue) => {
    const normalized = normalizeSearchText(seedTitle);
    if (!normalized) return;
    if (seeds.some((seed) => seed.normalizedTitle === normalized)) return;
    seeds.push({
      title: String(seedTitle).trim(),
      normalizedTitle: normalized,
      source,
      sourceValue,
    });
  };
  const pushSupplementalSeeds = (seedTitle, source, sourceValue) => {
    const supplementalTitles = buildSupplementalSeedTitles(seedTitle);
    supplementalTitles.forEach((supplementalTitle) => {
      pushSeed(supplementalTitle, `${source}_normalized`, sourceValue);
    });
  };

  if (title) {
    pushSeed(title, 'title', title);
    pushSupplementalSeeds(title, 'title', title);
  }

  if (itemId) {
    const { data: localItem } = await supabase
      .from('items')
      .select('item_title')
      .eq('user_id', user_id)
      .eq('ebay_user_id', account)
      .eq('ebay_item_id', itemId)
      .maybeSingle();

    if (localItem?.item_title) {
      pushSeed(localItem.item_title, 'itemId_local', itemId);
      pushSupplementalSeeds(localItem.item_title, 'itemId_local', itemId);
    } else {
      const refreshToken = await getRefreshTokenByEbayUserId(account);
      const accessToken = await refreshEbayToken(refreshToken);
      const item = await fetchItemDetails(itemId, accessToken);
      if (item?.Title) {
        pushSeed(item.Title, 'itemId_ebay', itemId);
        pushSupplementalSeeds(item.Title, 'itemId_ebay', itemId);
      }
    }
  }

  if (sku) {
    const normalizedSku = String(sku || '').trim();
    const { data: localSkuItem } = await supabase
      .from('items')
      .select('item_title')
      .eq('user_id', user_id)
      .eq('ebay_user_id', account)
      .ilike('sku', `%${normalizedSku}%`)
      .limit(1)
      .maybeSingle();

    if (localSkuItem?.item_title) {
      pushSeed(localSkuItem.item_title, 'sku_local', normalizedSku);
      pushSupplementalSeeds(localSkuItem.item_title, 'sku_local', normalizedSku);
    } else {
      if (!looksLikeUrl(normalizedSku)) {
        try {
          const inventoryItem = await fetchInventoryItemBySku(account, normalizedSku);
          if (inventoryItem?.product?.title) {
            pushSeed(inventoryItem.product.title, 'sku_ebay', normalizedSku);
            pushSupplementalSeeds(inventoryItem.product.title, 'sku_ebay', normalizedSku);
          }
        } catch (error) {
          console.warn('[item-search] failed to resolve sku via inventory api:', {
            account,
            sku: normalizedSku,
            error: error.message,
          });
        }
      }
    }
  }

  return seeds;
}

const toUsSupplierCandidate = (listing, account) => ({
  ebay_item_id: listing.legacyItemId || null,
  ebay_user_id: account,
  sku: listing.sku || null,
  item_title: listing.item_title || null,
  stocking_url: null,
  cost_price: null,
  estimated_shipping_cost: null,
  current_price_value: listing.current_price_value ?? null,
  current_price_currency: listing.current_price_currency ?? null,
  primary_image_url: listing.primary_image_url || null,
  updated_at: null,
  supplier_url: normalizeEbayViewUrlToUs(listing.view_item_url || null, listing.legacyItemId || null),
  site_code: listing.site_code || null,
  is_us_listing: true,
});

const logItemSearchStep = (label, details = {}) => {
  console.log(`[item-search] ${label}`, details);
};

async function searchHistoricalUsItemsByTitle({ userId, account, seedTitle, excludeItemId, limit }) {
  const pattern = titleToLikePattern(seedTitle);
  if (!pattern) return [];

  const { data, error } = await supabase
    .from('items')
    .select('ebay_item_id, ebay_user_id, sku, item_title, stocking_url, cost_price, estimated_shipping_cost, current_price_value, current_price_currency, primary_image_url, updated_at')
    .eq('user_id', userId)
    .eq('ebay_user_id', account)
    .neq('ebay_item_id', excludeItemId)
    .eq('current_price_currency', 'USD')
    .ilike('item_title', `%${pattern}%`)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Error fetching historical US items: ${error.message}`);
  }

  const tokens = extractSearchTokens(seedTitle);
  return (data || []).filter((item) => titleMatchesTokens(item.item_title, tokens));
}

async function enrichHistoricalItemsWithImages(account, items) {
  const rows = Array.isArray(items) ? items : [];
  const missingImageRows = rows.filter((item) => !item?.primary_image_url && item?.ebay_item_id).slice(0, 5);
  if (missingImageRows.length === 0) {
    return rows;
  }

  const refreshToken = await getRefreshTokenByEbayUserId(account);
  const accessToken = await refreshEbayToken(refreshToken);
  const imageMap = new Map();

  await Promise.all(missingImageRows.map(async (item) => {
    try {
      const ebayItem = await fetchItemDetails(item.ebay_item_id, accessToken);
      const rawPictures = ebayItem?.PictureDetails?.PictureURL;
      const primaryImage = Array.isArray(rawPictures) ? rawPictures[0] : rawPictures || null;
      if (primaryImage) {
        imageMap.set(String(item.ebay_item_id), primaryImage);
      }
    } catch (error) {
      console.warn('[item-search] failed to enrich historical item image:', {
        account,
        ebayItemId: item.ebay_item_id,
        error: error.message,
      });
    }
  }));

  return rows.map((item) => ({
    ...item,
    primary_image_url: item.primary_image_url || imageMap.get(String(item.ebay_item_id)) || null,
  }));
}

async function searchItemIdSupplierCandidates({ userId, account, itemId, seeds, numericLimit }) {
  const startedAt = Date.now();
  const candidateMap = new Map();
  const seedEntries = seeds.slice(0, 2);
  const normalizedItemId = String(itemId || '').trim();

  logItemSearchStep('itemId search start', {
    account,
    itemId: normalizedItemId,
    seedCount: seedEntries.length,
    seeds: seedEntries.map((seed) => ({
      source: seed.source,
      title: seed.title,
    })),
    limit: numericLimit,
  });

  const pushCandidate = (listing, seed, matchSource) => {
    const listingItemId = String(listing.legacyItemId || listing.ebay_item_id || '').trim();
    if (listingItemId === normalizedItemId) return;
    const candidate = listing.supplier_url
      ? {
          ebay_item_id: listing.ebay_item_id || listingItemId || null,
          ebay_user_id: listing.ebay_user_id || account,
          sku: listing.sku || null,
          item_title: listing.item_title || null,
          stocking_url: listing.stocking_url || null,
          cost_price: listing.cost_price ?? null,
          estimated_shipping_cost: listing.estimated_shipping_cost ?? null,
          current_price_value: listing.current_price_value ?? null,
          current_price_currency: listing.current_price_currency ?? null,
          primary_image_url: listing.primary_image_url || null,
          updated_at: listing.updated_at || null,
          supplier_url: listing.supplier_url,
          site_code: listing.site_code || 'US',
          is_us_listing: listing.is_us_listing !== false,
        }
      : toUsSupplierCandidate(listing, account);
    if (!candidate?.is_us_listing) return;
    const key = `${candidate.ebay_user_id || ''}:${candidate.ebay_item_id || ''}:${candidate.supplier_url || ''}`;
    if (candidateMap.has(key)) return;
    candidateMap.set(key, {
      ...candidate,
      matched_title: seed.title,
      match_source: `${seed.source}_${matchSource}`,
    });
  };

  for (const seed of seedEntries) {
    const seedStartedAt = Date.now();
    logItemSearchStep('seed search start', {
      account,
      itemId: normalizedItemId,
      seedSource: seed.source,
      seedTitle: seed.title,
    });

    const searchStartedAt = Date.now();
    const marketplaceListings = await searchUsMarketplaceByTitle(seed.title, Math.min(Math.max(numericLimit, 10), 20)).catch((error) => {
      console.warn('[item-search] failed to search marketplace by title:', {
        account,
        itemId: normalizedItemId,
        seedSource: seed.source,
        seedTitle: seed.title,
        error: error.message,
      });
      return [];
    });
    const marketplaceElapsedMs = Date.now() - searchStartedAt;

    const beforePushCount = candidateMap.size;
    marketplaceListings.forEach((item) => {
      if (String(item.ebay_item_id || '') === normalizedItemId) return;
      const listing = {
        legacyItemId: item.ebay_item_id,
        sku: item.sku,
        item_title: item.item_title,
        primary_image_url: item.primary_image_url,
        current_price_value: item.current_price_value,
        current_price_currency: item.current_price_currency,
        site_code: item.site_code,
        is_us_listing: item.is_us_listing,
        view_item_url: item.supplier_url,
      };
      pushCandidate(listing, seed, 'title_search_us');
    });

    const historicalStartedAt = Date.now();
    const historicalListings = await searchHistoricalUsItemsByTitle({
      userId,
      account,
      seedTitle: seed.title,
      excludeItemId: normalizedItemId,
      limit: Math.min(Math.max(numericLimit, 10), 30),
    }).catch((error) => {
      console.warn('[item-search] failed to search historical items by title:', {
        account,
        itemId: normalizedItemId,
        seedSource: seed.source,
        seedTitle: seed.title,
        error: error.message,
      });
      return [];
    });
    const enrichedHistoricalListings = await enrichHistoricalItemsWithImages(account, historicalListings);
    const historicalElapsedMs = Date.now() - historicalStartedAt;
    enrichedHistoricalListings.forEach((item) => {
      pushCandidate({
        ...item,
        supplier_url: item.stocking_url || (looksLikeUrl(item.sku) ? item.sku : buildUsEbayItemUrl(item.ebay_item_id)),
        site_code: 'US',
        is_us_listing: true,
      }, seed, 'historical_us');
    });

    const addedCount = candidateMap.size - beforePushCount;

    logItemSearchStep('seed search done', {
      account,
      itemId: normalizedItemId,
      seedSource: seed.source,
      seedTitle: seed.title,
      marketplaceListingsCount: marketplaceListings.length,
      historicalListingsCount: enrichedHistoricalListings.length,
      addedCandidates: addedCount,
      candidateTotal: candidateMap.size,
      elapsedMs: Date.now() - seedStartedAt,
      marketplaceElapsedMs,
      historicalElapsedMs,
    });

    if (candidateMap.size >= numericLimit) {
      break;
    }
  }

  logItemSearchStep('itemId search done', {
    account,
    itemId: normalizedItemId,
    seedCount: seedEntries.length,
    candidateCount: candidateMap.size,
    elapsedMs: Date.now() - startedAt,
  });

  return {
    seeds,
    candidates: Array.from(candidateMap.values()).slice(0, numericLimit),
  };
}

async function searchSupplierCandidates(queryParams) {
  const { user_id, account, title, sku, itemId, limit = 50 } = queryParams;

  if (!user_id) {
    throw new Error('user_id is required');
  }
  if (!account) {
    throw new Error('account is required');
  }
  if (!title && !sku && !itemId) {
    throw new Error('title, sku, or itemId is required');
  }
  if (title && !sku && !itemId) {
    const normalizedTitle = normalizeSearchText(title);
    if (normalizedTitle.length < 12 || countSearchTerms(normalizedTitle) < 3) {
      throw new Error('検索条件が広すぎます。キーワードを足してください。');
    }
  }

  const numericLimit = Number.isFinite(Number(limit)) ? Number(limit) : 50;
  const seeds = await resolveLookupSeeds({ user_id, account, title, sku, itemId });

  if (!seeds.length) {
    return { seeds: [], candidates: [] };
  }

  if (itemId) {
    return searchItemIdSupplierCandidates({ userId: user_id, account, itemId, seeds, numericLimit });
  }

  const candidateMap = new Map();
  const pushCandidate = (item, seedTitle, seedSource) => {
    const key = `${item.ebay_user_id || ''}:${item.ebay_item_id || ''}:${item.supplier_url || ''}`;
    if (candidateMap.has(key)) return;
    candidateMap.set(key, {
      ...item,
      matched_title: seedTitle,
      match_source: seedSource,
    });
  };

  for (const seed of seeds.slice(0, 3)) {
    try {
      const usListings = await searchUsMarketplaceByTitle(seed.title, Math.min(numericLimit, 10));
      usListings.forEach((item) => {
        pushCandidate(item, seed.title, `${seed.source}_ebay_us_marketplace`);
      });
      if (candidateMap.size >= numericLimit) {
        return {
          seeds,
          candidates: Array.from(candidateMap.values()).slice(0, numericLimit),
        };
      }
    } catch (error) {
      console.warn('[item-search] failed to search EBAY-US marketplace:', error.message);
    }
  }

  for (const seed of seeds) {
    const pattern = titleToLikePattern(seed.title);
    if (!pattern) continue;
    const fallbackTokens = extractSearchTokens(seed.title);

    const { data, error } = await supabase
      .from('items')
      .select('ebay_item_id, ebay_user_id, sku, item_title, stocking_url, cost_price, estimated_shipping_cost, current_price_value, current_price_currency, primary_image_url, updated_at')
      .eq('user_id', user_id)
      .not('stocking_url', 'is', null)
      .ilike('item_title', `%${pattern}%`)
      .order('updated_at', { ascending: false })
      .limit(numericLimit);

    if (error) {
      if (String(error.message || '').includes('statement timeout')) {
        throw new Error('検索条件が広すぎます。キーワードを足してください。');
      }
      throw new Error(`Error fetching supplier candidates: ${error.message}`);
    }

    (data || []).forEach((item) => {
      pushCandidate({
        ...item,
        supplier_url: item.stocking_url || null,
      }, seed.title, seed.source);
    });

    const { data: lineItems, error: lineItemsError } = await supabase
      .from('order_line_items')
      .select('order_no, legacy_item_id, title, procurement_url, stocking_url, cost_price, item_image, created_at')
      .or('procurement_url.not.is.null,stocking_url.not.is.null')
      .ilike('title', `%${pattern}%`)
      .order('created_at', { ascending: false })
      .limit(numericLimit);

    if (lineItemsError) {
      if (String(lineItemsError.message || '').includes('statement timeout')) {
        throw new Error('検索条件が広すぎます。キーワードを足してください。');
      }
      throw new Error(`Error fetching supplier candidates from order_line_items: ${lineItemsError.message}`);
    }

    const orderNos = [...new Set((lineItems || []).map((item) => item.order_no).filter(Boolean))];
    let orderMap = new Map();
    if (orderNos.length > 0) {
      const { data: relatedOrders, error: relatedOrdersError } = await supabase
        .from('orders')
        .select('order_no, user_id, ebay_user_id')
        .eq('user_id', user_id)
        .in('order_no', orderNos);

      if (relatedOrdersError) {
        throw new Error(`Error fetching related orders: ${relatedOrdersError.message}`);
      }

      orderMap = new Map((relatedOrders || []).map((order) => [order.order_no, order]));
    }

    (lineItems || []).forEach((item) => {
      const relatedOrder = orderMap.get(item.order_no);
      if (!relatedOrder) return;
      pushCandidate({
        ebay_item_id: item.legacy_item_id || null,
        ebay_user_id: relatedOrder.ebay_user_id || null,
        sku: null,
        item_title: item.title || null,
        stocking_url: item.stocking_url || null,
        cost_price: item.cost_price ?? null,
        estimated_shipping_cost: null,
        current_price_value: null,
        current_price_currency: null,
        primary_image_url: item.item_image || null,
        updated_at: item.created_at || null,
        supplier_url: item.procurement_url || item.stocking_url || null,
      }, seed.title, `${seed.source}_order_line_items`);
    });

    if (candidateMap.size === 0 && fallbackTokens.length >= 2) {
      let fallbackItemsQuery = supabase
        .from('items')
        .select('ebay_item_id, ebay_user_id, sku, item_title, stocking_url, cost_price, estimated_shipping_cost, current_price_value, current_price_currency, primary_image_url, updated_at')
        .eq('user_id', user_id)
        .not('stocking_url', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(numericLimit);
      fallbackItemsQuery = applyTokenFilters(fallbackItemsQuery, 'item_title', fallbackTokens);
      const { data: fallbackItems, error: fallbackItemsError } = await fallbackItemsQuery;

      if (fallbackItemsError) {
        throw new Error(`Error fetching fallback supplier candidates: ${fallbackItemsError.message}`);
      }

      (fallbackItems || []).forEach((item) => {
        pushCandidate({
          ...item,
          supplier_url: item.stocking_url || null,
        }, seed.title, `${seed.source}_token_fallback`);
      });

      let fallbackLineItemsQuery = supabase
        .from('order_line_items')
        .select('order_no, legacy_item_id, title, procurement_url, stocking_url, cost_price, item_image, created_at')
        .or('procurement_url.not.is.null,stocking_url.not.is.null')
        .order('created_at', { ascending: false })
        .limit(numericLimit);
      fallbackLineItemsQuery = applyTokenFilters(fallbackLineItemsQuery, 'title', fallbackTokens);
      const { data: fallbackLineItems, error: fallbackLineItemsError } = await fallbackLineItemsQuery;

      if (fallbackLineItemsError) {
        throw new Error(`Error fetching fallback order_line_items candidates: ${fallbackLineItemsError.message}`);
      }

      const fallbackOrderNos = [...new Set((fallbackLineItems || []).map((item) => item.order_no).filter(Boolean))];
      let fallbackOrderMap = new Map();
      if (fallbackOrderNos.length > 0) {
        const { data: fallbackOrders, error: fallbackOrdersError } = await supabase
          .from('orders')
          .select('order_no, user_id, ebay_user_id')
          .eq('user_id', user_id)
          .in('order_no', fallbackOrderNos);
        if (fallbackOrdersError) {
          throw new Error(`Error fetching fallback related orders: ${fallbackOrdersError.message}`);
        }
        fallbackOrderMap = new Map((fallbackOrders || []).map((order) => [order.order_no, order]));
      }

      (fallbackLineItems || []).forEach((item) => {
        const relatedOrder = fallbackOrderMap.get(item.order_no);
        if (!relatedOrder) return;
        pushCandidate({
          ebay_item_id: item.legacy_item_id || null,
          ebay_user_id: relatedOrder.ebay_user_id || null,
          sku: null,
          item_title: item.title || null,
          stocking_url: item.stocking_url || null,
          cost_price: item.cost_price ?? null,
          estimated_shipping_cost: null,
          current_price_value: null,
          current_price_currency: null,
          primary_image_url: item.item_image || null,
          updated_at: item.created_at || null,
          supplier_url: item.procurement_url || item.stocking_url || null,
        }, seed.title, `${seed.source}_order_line_items_token_fallback`);
      });
    }

    if (candidateMap.size === 0) {
      const ebayListings = await fetchEbayListingSeeds(account, seed.title);
      const ebayItemIds = ebayListings.map((listing) => listing.legacyItemId).filter(Boolean);
      const ebayTitles = ebayListings.map((listing) => listing.item_title).filter(Boolean);

      if (ebayItemIds.length > 0) {
        const { data: ebayLineItems, error: ebayLineItemsError } = await supabase
          .from('order_line_items')
          .select('order_no, legacy_item_id, title, procurement_url, stocking_url, cost_price, item_image, created_at')
          .in('legacy_item_id', ebayItemIds)
          .or('procurement_url.not.is.null,stocking_url.not.is.null')
          .order('created_at', { ascending: false })
          .limit(numericLimit);

        if (ebayLineItemsError) {
          throw new Error(`Error fetching eBay fallback line items: ${ebayLineItemsError.message}`);
        }

        const ebayOrderNos = [...new Set((ebayLineItems || []).map((item) => item.order_no).filter(Boolean))];
        let ebayOrderMap = new Map();
        if (ebayOrderNos.length > 0) {
          const { data: ebayOrders, error: ebayOrdersError } = await supabase
            .from('orders')
            .select('order_no, user_id, ebay_user_id')
            .eq('user_id', user_id)
            .in('order_no', ebayOrderNos);
          if (ebayOrdersError) {
            throw new Error(`Error fetching eBay fallback related orders: ${ebayOrdersError.message}`);
          }
          ebayOrderMap = new Map((ebayOrders || []).map((order) => [order.order_no, order]));
        }

        (ebayLineItems || []).forEach((item) => {
          const relatedOrder = ebayOrderMap.get(item.order_no);
          if (!relatedOrder) return;
          pushCandidate({
            ebay_item_id: item.legacy_item_id || null,
            ebay_user_id: relatedOrder.ebay_user_id || null,
            sku: null,
            item_title: item.title || null,
            stocking_url: item.stocking_url || null,
            cost_price: item.cost_price ?? null,
            estimated_shipping_cost: null,
            current_price_value: null,
            current_price_currency: null,
            primary_image_url: item.item_image || null,
            updated_at: item.created_at || null,
            supplier_url: item.procurement_url || item.stocking_url || null,
          }, seed.title, `${seed.source}_ebay_listing_itemid_fallback`);
        });
      }

      if (candidateMap.size === 0 && ebayTitles.length > 0) {
        for (const ebayTitle of ebayTitles.slice(0, 10)) {
          const ebayPattern = titleToLikePattern(ebayTitle);
          if (!ebayPattern) continue;
          const { data: ebayTitleLineItems, error: ebayTitleLineItemsError } = await supabase
            .from('order_line_items')
            .select('order_no, legacy_item_id, title, procurement_url, stocking_url, cost_price, item_image, created_at')
            .or('procurement_url.not.is.null,stocking_url.not.is.null')
            .ilike('title', `%${ebayPattern}%`)
            .order('created_at', { ascending: false })
            .limit(numericLimit);

          if (ebayTitleLineItemsError) {
            throw new Error(`Error fetching eBay fallback title matches: ${ebayTitleLineItemsError.message}`);
          }

          const ebayTitleOrderNos = [...new Set((ebayTitleLineItems || []).map((item) => item.order_no).filter(Boolean))];
          let ebayTitleOrderMap = new Map();
          if (ebayTitleOrderNos.length > 0) {
            const { data: ebayTitleOrders, error: ebayTitleOrdersError } = await supabase
              .from('orders')
              .select('order_no, user_id, ebay_user_id')
              .eq('user_id', user_id)
              .in('order_no', ebayTitleOrderNos);
            if (ebayTitleOrdersError) {
              throw new Error(`Error fetching eBay fallback title related orders: ${ebayTitleOrdersError.message}`);
            }
            ebayTitleOrderMap = new Map((ebayTitleOrders || []).map((order) => [order.order_no, order]));
          }

          (ebayTitleLineItems || []).forEach((item) => {
            const relatedOrder = ebayTitleOrderMap.get(item.order_no);
            if (!relatedOrder) return;
            pushCandidate({
              ebay_item_id: item.legacy_item_id || null,
              ebay_user_id: relatedOrder.ebay_user_id || null,
              sku: null,
              item_title: item.title || null,
              stocking_url: item.stocking_url || null,
              cost_price: item.cost_price ?? null,
              estimated_shipping_cost: null,
              current_price_value: null,
              current_price_currency: null,
              primary_image_url: item.item_image || null,
              updated_at: item.created_at || null,
              supplier_url: item.procurement_url || item.stocking_url || null,
            }, seed.title, `${seed.source}_ebay_listing_title_fallback`);
          });

          if (candidateMap.size > 0) {
            break;
          }
        }
      }
    }

    if (candidateMap.size === 0) {
      const sellerListings = await fetchSellerListingsByTitle(account, seed.title);
      sellerListings.forEach((listing) => {
        pushCandidate({
          ebay_item_id: listing.legacyItemId || null,
          ebay_user_id: account,
          sku: listing.sku || null,
          item_title: listing.item_title || null,
          stocking_url: null,
          cost_price: null,
          estimated_shipping_cost: null,
          current_price_value: null,
          current_price_currency: null,
          primary_image_url: listing.primary_image_url || null,
          updated_at: null,
          supplier_url: looksLikeUrl(listing.sku)
            ? listing.sku
            : normalizeEbayViewUrlToUs(listing.view_item_url, listing.legacyItemId || null),
          view_item_url: listing.view_item_url || null,
        }, seed.title, `${seed.source}_seller_list_fallback`);
      });
    }
  }

  return {
    seeds,
    candidates: Array.from(candidateMap.values()).slice(0, numericLimit),
  };
}

module.exports = { searchItems, getOrdersForMonth, searchItemsSimple, searchSupplierCandidates };
