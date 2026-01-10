const axios = require('axios');
const supabase = require('../supabaseClient');
const { fetchEbayAccountTokens, refreshEbayToken, getRefreshTokenByEbayUserId } = require("./accountService")
const { fetchItemDetails } = require("./itemService")
const { upsertBuyer } = require('./buyerService');
const { logError } = require('./loggingService');
const { logSystemError } = require('./systemErrorService');
const { fetchShipmentDetailsByReference } = require('./shipcoService');

const EBAY_FULFILLMENT_API_BASE = 'https://api.ebay.com/sell/fulfillment/v1';

const DEFAULT_PAYOUT_CURRENCY = 'USD';
const INCENTIVE_RATE = 0.1;

const ENV_EXCHANGE_RATES = {
    USD: Number(process.env.EXCHANGE_RATE_USD_TO_JPY) || 145,
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
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
};

const sumCostPriceJpy = (lineItems = []) =>
    lineItems.reduce((total, item) => total + toNumber(item?.cost_price), 0);

const loadUserExchangeRates = async (userId) => {
    const rates = { ...ENV_EXCHANGE_RATES };
    rates.JPY = 1;
    const targetUserId = userId || 2;
    try {
        const { data, error } = await supabase
            .from('users')
            .select('usd_rate, eur_rate, cad_rate, gbp_rate, aud_rate')
            .eq('id', targetUserId)
            .single();

        if (error) {
            console.error('Failed to load user exchange rates:', error.message);
            return rates;
        }

        if (!data) {
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
            const value = data[column];
            if (value === undefined || value === null) {
                return;
            }
            const numeric = Number(value);
            if (Number.isFinite(numeric)) {
                rates[currency] = numeric;
            }
        });
    } catch (err) {
        console.error('Unexpected error while loading exchange rates:', err);
    }
    return rates;
};

const calculateOrderFinancials = (order, exchangeRates) => {
    const earningsAfterFee = toNumber(order.earnings_after_pl_fee || order.earnings);
    const earningsCurrency = normalizeCurrencyCode(order.earnings_after_pl_fee_currency) ||
        normalizeCurrencyCode(order.earnings_currency) ||
        DEFAULT_PAYOUT_CURRENCY;
    const rate = exchangeRates[earningsCurrency];
    const earningsAfterFeeJpy = rate ? earningsAfterFee * rate : null;
    const shippingCostJpy = toNumber(order.estimated_shipping_cost);
    const costPriceJpy = sumCostPriceJpy(order.line_items || []);
    const profitJpy = earningsAfterFeeJpy !== null
        ? earningsAfterFeeJpy - shippingCostJpy - costPriceJpy
        : null;
    const profitMargin = earningsAfterFeeJpy && earningsAfterFeeJpy !== 0
        ? (profitJpy / earningsAfterFeeJpy) * 100
        : null;
    const researcherIncentive = profitJpy && profitJpy > 0 ? profitJpy * INCENTIVE_RATE : 0;

    return {
        earningsAfterFeeJpy,
        shippingCostJpy,
        costPriceJpy,
        profitJpy,
        profitMargin,
        rateApplied: rate !== undefined && rate !== null,
        earningsCurrency,
        researcherIncentive,
    };
};

const attachFinancialsToOrder = (order, exchangeRates) => {
    const financials = calculateOrderFinancials(order, exchangeRates);
    return {
        ...order,
        calculated_earnings_after_fee_jpy: financials.earningsAfterFeeJpy,
        calculated_profit_jpy: financials.profitJpy,
        calculated_profit_margin: financials.profitMargin,
        calculated_cost_price_jpy: financials.costPriceJpy,
        calculated_shipping_cost_jpy: financials.shippingCostJpy,
        calculated_exchange_rate_applied: financials.rateApplied,
        calculated_exchange_rate_currency: financials.earningsCurrency,
        researcherIncentive: financials.researcherIncentive,
    };
};

async function fetchOrdersFromEbay(refreshToken) {
    try {
        const baseUrl = 'https://api.ebay.com/sell/fulfillment/v1/order';
        const headers = {
            Authorization: `Bearer ${refreshToken}`,
            'Content-Type': 'application/json',
        };

        const fetchWithFilter = async (filter) => {
            const response = await axios({
                method: 'get',
                url: baseUrl,
                headers,
                params: filter ? { filter } : undefined,
            });
            return response.data.orders || [];
        };

        return await fetchWithFilter(null);
    } catch (error) {
        console.error('Error fetching orders from eBay:', error);
        throw error;
    }
}

async function fetchCancelledOrderNosFromEbay(accessToken, marketplaceId = 'EBAY_US') {
    const baseUrl = 'https://api.ebay.com/post-order/v2/cancellation/search';
    const headers = {
        Authorization: `IAF ${accessToken}`,
        'Content-Type': 'application/json',
        'X-EBAY-C-MARKETPLACE-ID': marketplaceId,
    };

    const now = new Date();
    const fromDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const creationDateRangeFrom = fromDate.toISOString();
    const creationDateRangeTo = now.toISOString();

    const orderNos = new Set();
    const limit = 200;
    let offset = 0;

    for (let page = 0; page < 50; page += 1) {
        const response = await axios({
            method: 'get',
            url: baseUrl,
            headers,
            params: {
                creation_date_range_from: creationDateRangeFrom,
                creation_date_range_to: creationDateRangeTo,
                limit,
                offset,
            },
        });

        const data = response?.data || {};
        const cancellations =
            data.cancellations ||
            data.cancellationRequests ||
            data.cancellation ||
            [];

        if (offset === 0 && Array.isArray(cancellations)) {
            console.info(
                '[orderService] Cancellation search result:',
                `count=${cancellations.length}`,
                `keys=${Object.keys(data || {}).join(',') || 'none'}`
            );
            const firstCancellation = cancellations[0] || null;
            if (firstCancellation) {
                console.info(
                    '[orderService] Cancellation sample:',
                    JSON.stringify({
                        order_id: firstCancellation?.order_id,
                        orderId: firstCancellation?.orderId,
                        order: firstCancellation?.order
                            ? {
                                order_id: firstCancellation.order.order_id,
                                orderId: firstCancellation.order.orderId,
                            }
                            : null,
                        legacy_order_id: firstCancellation?.legacy_order_id,
                        legacyOrderId: firstCancellation?.legacyOrderId,
                    })
                );
            }
        }

        if (!Array.isArray(cancellations) || cancellations.length === 0) {
            break;
        }

        cancellations.forEach((cancellation) => {
            const orderNo =
                cancellation?.order_id ||
                cancellation?.orderId ||
                cancellation?.legacy_order_id ||
                cancellation?.legacyOrderId ||
                cancellation?.order?.orderId ||
                cancellation?.order?.order_id ||
                null;
            if (orderNo) {
                orderNos.add(orderNo);
            }
        });

        if (cancellations.length < limit) {
            break;
        }

        offset += cancellations.length;
    }

    return Array.from(orderNos);
}

/**
 * 注文情報からバイヤー情報を取得し、データベースにアップサートする関数
 * @param {Object} order - バイヤー情報を含む注文オブジェクト
 * @param {number} userId - ユーザーID
 * @returns {Object} - バイヤー情報
 */
async function fetchAndUpsertBuyer(order, userId) {
    const buyerInfo = order?.buyer || {};
    const registrationAddress = buyerInfo?.buyerRegistrationAddress || {};
    const contactAddress = registrationAddress?.contactAddress || null;
    const primaryPhone = registrationAddress?.primaryPhone || {};

    return await upsertBuyer({
        ebay_buyer_id: buyerInfo?.username || null,
        name: registrationAddress?.fullName || null,
        user_id: userId,
        ebay_user_id: order?.sellerId || null,
        address: contactAddress,
        phone_number: primaryPhone?.phoneNumber || null,
        last_purchase_date: order?.creationDate || new Date().toISOString(),
        registered_date: new Date().toISOString()
    });
}

/**
 * 商品画像の取得やitemsテーブルからの商品データの更新を含む、ラインアイテムを取得して処理する関数
 * @param {Object} order - ラインアイテムを含む注文オブジェクト
 * @param {string} accessToken - eBay APIのアクセストークン
 * @param {Object} existingImages - 既存の画像マップ
 * @param {Object} itemsMap - itemsテーブルからの商品のマップ
 * @returns {Array} - 処理されたラインアイテム
 */
async function fetchAndProcessLineItems(order, accessToken, existingImages, itemsMap) {
    return await Promise.all(order.lineItems.map(async (item) => {
        let itemImage = existingImages[item.legacyItemId];
        if (!itemImage) {
            try {

                const itemDetails = await fetchItemDetails(item.legacyItemId, accessToken);
                itemImage = itemDetails
                    ? selectItemImageUrl(itemDetails.PictureDetails, itemDetails.GalleryURL)
                    : null;
            } catch (error) {

                console.error('商品画像の取得エラー:', error.message);
                itemImage = null;
            }
        }

        const itemData = itemsMap[item.legacyItemId];
        return {
            ...item,
            itemImage,
            stocking_url: itemData ? itemData.stocking_url : null,
            cost_price: itemData ? itemData.cost_price : null
        };
    }));
}

function isValidImageUrl(value) {
    if (!value || typeof value !== 'string') {
        return false;
    }
    const trimmed = value.trim();
    if (trimmed.length < 8) {
        return false;
    }
    return trimmed.startsWith('http://') || trimmed.startsWith('https://');
}

function selectItemImageUrl(pictureDetails = {}, fallbackGalleryUrl = null) {
    const candidates = [];
    if (pictureDetails) {
        if (Array.isArray(pictureDetails.PictureURL)) {
            candidates.push(...pictureDetails.PictureURL);
        } else if (pictureDetails.PictureURL) {
            candidates.push(pictureDetails.PictureURL);
        }
        if (pictureDetails.GalleryURL) {
            candidates.push(pictureDetails.GalleryURL);
        }
    }
    if (fallbackGalleryUrl) {
        candidates.push(fallbackGalleryUrl);
    }
    return candidates.find((candidate) => isValidImageUrl(candidate)) || null;
}

const PROCUREMENT_STATUS_ALIASES = {
    NEW: 'NEW',
    '新': 'NEW',
    ORDERED: 'ORDERED',
    '注': 'ORDERED',
    STOCKED_SHIPPED: 'STOCKED_SHIPPED',
    '配': 'STOCKED_SHIPPED',
    RECEIVED: 'RECEIVED',
    '受': 'RECEIVED',
    OUTOFSTOCK: 'OUTOFSTOCK',
    OUT_OF_STOCK: 'OUTOFSTOCK',
    OUTOF_STOCK: 'OUTOFSTOCK',
    'OUT OF STOCK': 'OUTOFSTOCK',
    '欠': 'OUTOFSTOCK',
    '欠品': 'OUTOFSTOCK'
};

const PROCUREMENT_ORDER_STATUSES = new Set(['ORDERED', 'OUTOFSTOCK']);

function normalizeProcurementStatusValue(status) {
    if (status === undefined || status === null) {
        return null;
    }
    const raw = String(status).trim();
    if (!raw) {
        return null;
    }
    const upper = raw.toUpperCase();
    if (PROCUREMENT_STATUS_ALIASES.hasOwnProperty(upper)) {
        return PROCUREMENT_STATUS_ALIASES[upper];
    }
    if (PROCUREMENT_STATUS_ALIASES.hasOwnProperty(raw)) {
        return PROCUREMENT_STATUS_ALIASES[raw];
    }
    return upper;
}
function shouldTrackProcurementOrderedAt(status) {
    if (!status) {
        return false;
    }
    return PROCUREMENT_ORDER_STATUSES.has(status);
}

function normalizeOrderLineItem(item = {}) {
    const legacyItemId = item.legacyItemId || item.legacy_item_id || null;
    const lineItemId = item.lineItemId || item.id || null;
    const totalValue = item.total?.value ?? item.total_value ?? null;
    const totalCurrency = item.total?.currency ?? item.total_currency ?? null;
    const lineItemCostValue = item.lineItemCost?.value ?? item.line_item_cost_value ?? null;
    const lineItemCostCurrency = item.lineItemCost?.currency ?? item.line_item_cost_currency ?? null;
    const normalizedProcurementStatus = normalizeProcurementStatusValue(
        item.procurement_status ??
        item.procurementStatus ??
        item.stocking_status ??
        item.stockingStatus ??
        null
    );

    return {
        ...item,
        legacyItemId,
        legacy_item_id: legacyItemId,
        lineItemId,
        id: lineItemId,
        total: totalValue !== null ? { value: totalValue, currency: totalCurrency } : item.total || null,
        total_value: totalValue,
        total_currency: totalCurrency,
        lineItemCost: lineItemCostValue !== null ? { value: lineItemCostValue, currency: lineItemCostCurrency } : item.lineItemCost || null,
        line_item_cost_value: lineItemCostValue,
        line_item_cost_currency: lineItemCostCurrency,
        itemImage: item.itemImage ?? item.item_image ?? null,
        item_image: item.item_image ?? item.itemImage ?? null,
        procurement_tracking_number: item.procurement_tracking_number ?? item.procurementTrackingNumber ?? null,
        procurementTrackingNumber: item.procurementTrackingNumber ?? item.procurement_tracking_number ?? null,
        procurement_site_name: item.procurement_site_name ?? item.procurementSiteName ?? null,
        procurementSiteName: item.procurementSiteName ?? item.procurement_site_name ?? null,
        procurement_status: normalizedProcurementStatus,
        procurementStatus: normalizedProcurementStatus,
        stocking_status: normalizedProcurementStatus,
        cost_price: item.cost_price ?? item.costPrice ?? null,
        stocking_url: item.stocking_url ?? item.stockingUrl ?? null,
        researcher: item.researcher ?? null,
        quantity: item.quantity ?? null,
    };
}

function attachNormalizedLineItemsToOrder(order) {
    if (!order) {
        return order;
    }
    const rawItems = order.order_line_items || order.line_items || [];
    const normalizedItems = rawItems.map(normalizeOrderLineItem);
    return {
        ...order,
        line_items: normalizedItems,
    };
}

const ensureArray = (value) => {
    if (Array.isArray(value)) {
        return value;
    }
    if (value === undefined || value === null) {
        return [];
    }
    return [value];
};

const extractTrackingFromShippingStep = (shippingStep = {}) => {
    if (!shippingStep || typeof shippingStep !== 'object') {
        return null;
    }
    const direct =
        shippingStep.shipmentTrackingNumber ||
        shippingStep.shipment_tracking_number ||
        shippingStep.trackingNumber ||
        shippingStep.tracking_number ||
        null;
    if (direct) {
        const normalized = String(direct).trim();
        if (normalized) {
            return normalized;
        }
    }
    const shipments = ensureArray(shippingStep.shipments);
    for (const shipment of shipments) {
        if (!shipment || typeof shipment !== 'object') {
            continue;
        }
        const candidate =
            shipment.shipmentTrackingNumber ||
            shipment.shipment_tracking_number ||
            shipment.trackingNumber ||
            shipment.tracking_number ||
            null;
        if (candidate) {
            const normalized = String(candidate).trim();
            if (normalized) {
                return normalized;
            }
        }
    }
    return null;
};

function extractShippingTrackingNumber(order = {}) {
    const fulfillmentInstructions = ensureArray(order.fulfillmentStartInstructions);
    for (const instruction of fulfillmentInstructions) {
        const tracking = extractTrackingFromShippingStep(instruction?.shippingStep);
        if (tracking) {
            return tracking;
        }
    }

    const lineItems = ensureArray(order.lineItems);
    for (const item of lineItems) {
        const lineItemInstructions = item?.lineItemFulfillmentInstructions;
        const instructionArray = ensureArray(lineItemInstructions);
        for (const instruction of instructionArray) {
            const shippingStep = instruction?.shippingStep || instruction?.ShippingStep;
            const tracking = extractTrackingFromShippingStep(shippingStep);
            if (tracking) {
                return tracking;
            }
            const direct =
                instruction?.shipmentTrackingNumber ||
                instruction?.shipment_tracking_number ||
                instruction?.trackingNumber ||
                instruction?.tracking_number ||
                null;
            if (direct) {
                const normalized = String(direct).trim();
                if (normalized) {
                    return normalized;
                }
            }
        }
    }

    const topLevelTracking =
        order.shipmentTrackingNumber ||
        order.shipment_tracking_number ||
        order.trackingNumber ||
        order.tracking_number ||
        null;

    if (!topLevelTracking) {
        return null;
    }
    const normalizedTop = String(topLevelTracking).trim();
    return normalizedTop || null;
}

/**
 * 注文明細をorder_line_itemsテーブルにアップサートする
 * @param {Object} order - eBay注文データ
 * @param {Array} lineItems - 加工済みラインアイテム
 * @param {string} researcher - リサーチ担当者
 */
async function upsertOrderLineItems(order, lineItems, researcher) {
    if (!lineItems?.length) {
        return;
    }

    const lineItemIds = lineItems.map((item) => item.lineItemId);
    const { data: existingLineItems, error: fetchError } = await supabase
        .from('order_line_items')
        .select('id, procurement_tracking_number, procurement_url, procurement_status, procurement_ordered_at, cost_price, researcher, item_image, stocking_url, total_value, total_currency, line_item_cost_value, line_item_cost_currency, quantity')
        .in('id', lineItemIds);

    if (fetchError && fetchError.code !== 'PGRST116') {
        console.error('order_line_items取得時のエラー:', fetchError.message);
    }

    const existingMap = {};
    existingLineItems?.forEach((item) => {
        existingMap[item.id] = item;
    });

    const toNumber = (value) => {
        if (value === undefined || value === null) {
            return null;
        }
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    };

    const records = lineItems.map((item) => {
        const existing = existingMap[item.lineItemId] || {};
        const existingStatus = normalizeProcurementStatusValue(existing.procurement_status);
        const incomingStatus = normalizeProcurementStatusValue(item.procurement_status ?? item.procurementStatus ?? item.stocking_status ?? item.stockingStatus ?? null);
        const procurementStatus = incomingStatus ?? existingStatus ?? 'NEW';
        let procurementOrderedAt = existing.procurement_ordered_at || null;
        if (shouldTrackProcurementOrderedAt(procurementStatus)) {
            procurementOrderedAt = procurementOrderedAt || new Date().toISOString();
        } else if (procurementStatus === 'NEW') {
            procurementOrderedAt = null;
        }
        return {
            id: item.lineItemId,
            order_no: order.orderId,
            legacy_item_id: item.legacyItemId || null,
            title: item.title || null,
            quantity: item.quantity ?? null,
            total_value: toNumber(item.total?.value) ?? existing.total_value ?? null,
            total_currency: item.total?.currency || existing.total_currency || null,
            line_item_cost_value: toNumber(item.lineItemCost?.value) ?? existing.line_item_cost_value ?? null,
            line_item_cost_currency: item.lineItemCost?.currency || existing.line_item_cost_currency || null,
            cost_price: toNumber(item.cost_price) ?? existing.cost_price ?? null,
            item_image: item.itemImage || existing.item_image || null,
            stocking_url: item.stocking_url || existing.stocking_url || null,
            researcher: researcher || item.researcher || existing.researcher || null,
            quantity: toNumber(item.quantity) ?? existing.quantity ?? null,
            procurement_tracking_number: existing.procurement_tracking_number || null,
            procurement_url: existing.procurement_url || item.stocking_url || null,
            procurement_status: procurementStatus,
            procurement_ordered_at: procurementOrderedAt,
            updated_at: new Date().toISOString()
        };
    });

    const { error: upsertError } = await supabase
        .from('order_line_items')
        .upsert(records, { onConflict: 'id' });

    if (upsertError) {
        console.error('order_line_itemsへのアップサートエラー:', upsertError.message);
    }
}

/**
 * 注文明細の仕入ステータスを更新する
 * @param {string} lineItemId - eBay lineItemId
 * @param {string} status - 更新後の仕入ステータス
 */
async function updateProcurementStatus(lineItemId, status) {
    const normalizedStatus = normalizeProcurementStatusValue(status);
    const nowIso = new Date().toISOString();

    const { data: existingItem, error: fetchError } = await supabase
        .from('order_line_items')
        .select('procurement_ordered_at')
        .eq('id', lineItemId)
        .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
        throw new Error('Failed to fetch order line item: ' + fetchError.message);
    }

    let procurementOrderedAt = existingItem?.procurement_ordered_at || null;
    if (shouldTrackProcurementOrderedAt(normalizedStatus)) {
        procurementOrderedAt = procurementOrderedAt || nowIso;
    } else if (normalizedStatus === 'NEW') {
        procurementOrderedAt = null;
    }

    const { data, error } = await supabase
        .from('order_line_items')
        .update({
            procurement_status: normalizedStatus,
            procurement_ordered_at: procurementOrderedAt,
            updated_at: nowIso
        })
        .eq('id', lineItemId)
        .select();

    if (error) {
        throw new Error('Failed to update procurement status: ' + error.message);
    }

    return data?.[0] || null;
}

/**
 * 注文明細の追跡番号を更新する
 * @param {string} lineItemId - eBay lineItemId
 * @param {string|null} trackingNumber - 追跡番号
 */
async function updateProcurementTrackingNumber(lineItemId, trackingNumber) {
    const { data, error } = await supabase
        .from('order_line_items')
        .update({
            procurement_tracking_number: trackingNumber,
            updated_at: new Date().toISOString()
        })
        .eq('id', lineItemId)
        .select();

    if (error) {
        throw new Error('Failed to update procurement tracking number: ' + error.message);
    }

    return data?.[0] || null;
}

/**
 * 複数の注文を発送済みに更新する
 * @param {Array<string>} orderIds - ordersテーブルのidリスト
 */
async function markOrdersAsShipped(orderIds) {
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
        return [];
    }

    const { data, error } = await supabase
        .from('orders')
        .update({
            shipping_status: 'SHIPPED'
        })
        .in('id', orderIds)
        .select('id, order_no, shipping_status');

    if (error) {
        throw new Error('Failed to update shipping status: ' + error.message);
    }

    return data || [];
}

/**
 * 注文情報をSupabaseにアップサートする関数
 * @param {Object} order - 注文の詳細を含む注文オブジェクト
 * @param {number} buyerId - バイヤーID
 * @param {number} userId - ユーザーID
 * @param {Array} lineItems - 処理されたラインアイテム
 * @param {number} shippingCost - 送料
 * @param {string} lineItemFulfillmentStatus - ラインアイテムの履行状況
 * @returns {Object} - 更新された注文データ
 */
async function updateOrderInSupabase(order, buyerId, userId, lineItems, shippingCost, lineItemFulfillmentStatus, researcher) {
    // 注文収益を計算する
    const earningsAfterPlFee = order.paymentSummary.totalDueSeller.value * 0.979; // 注文収益 - プロモーテッドリスティングス(2.1%)
    const toNumberOrNull = (value) => {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    };

    let shippingTrackingNumber = extractShippingTrackingNumber(order);
    if (shippingTrackingNumber) {
        console.info(
            `[orderService] Tracking number obtained from eBay payload for order ${order.orderId}: ${shippingTrackingNumber}`
        );
    } else {
        console.info(
            `[orderService] Tracking number not found on eBay payload for order ${order.orderId}.`
        );
    }

    // 既存のデータを取得
    const { data: existingData, error: fetchError } = await supabase
        .from('orders')
        .select('*')
        .eq('order_no', order.orderId)
        .single();

    if (fetchError && fetchError.code !== 'PGRST116') { // データが存在しない場合のエラーコードを無視
        console.error('Supabaseでの注文データの取得エラー:', fetchError.message);
        return null;
    }

    const normalizeCurrencyCode = (value) => {
        if (typeof value !== 'string') {
            return null;
        }
        const trimmed = value.trim();
        return trimmed ? trimmed.toUpperCase() : null;
    };

    const extractCurrencyFromNode = (node) => {
        if (!node || typeof node !== 'object') {
            return null;
        }
        const candidate =
            node.currency ||
            node.currency_code ||
            node.currencyCode ||
            node.currency_iso ||
            node.currencyIso ||
            null;
        return normalizeCurrencyCode(candidate);
    };

    const resolveCurrency = (incoming, existing) =>
        normalizeCurrencyCode(incoming) || normalizeCurrencyCode(existing) || null;

    const totalAmountCurrency = resolveCurrency(
        extractCurrencyFromNode(order.totalFeeBasisAmount),
        existingData?.total_amount_currency
    );
    const subtotalCurrency = resolveCurrency(
        extractCurrencyFromNode(order.pricingSummary?.priceSubtotal),
        existingData?.subtotal_currency
    );
    const earningsCurrency = resolveCurrency(
        extractCurrencyFromNode(order.paymentSummary?.totalDueSeller),
        existingData?.earnings_currency
    );
    const earningsAfterPlFeeCurrency = resolveCurrency(
        extractCurrencyFromNode(order.paymentSummary?.totalDueSeller),
        existingData?.earnings_after_pl_fee_currency || earningsCurrency
    );

    const existingShipcoSyncedAt = existingData?.shipco_synced_at || null;
    const shippingStatusRaw = existingData?.shipping_status || null;
    const normalizedShippingStatus =
        typeof shippingStatusRaw === 'string'
            ? shippingStatusRaw.trim().toUpperCase()
            : null;
    const shouldSkipShipcoIntegration =
        normalizedShippingStatus === 'UNSHIPPED' || shippingStatusRaw === '未';

    const existingShippingCost = toNumberOrNull(existingData?.shipco_shipping_cost);
    const fallbackShippingCost = toNumberOrNull(shippingCost);
    const existingEstimatedShippingCost = toNumberOrNull(existingData?.estimated_shipping_cost);

    const existingParcelWeight = toNumberOrNull(existingData?.shipco_parcel_weight);
    const existingParcelWeightUnit =
        typeof existingData?.shipco_parcel_weight_unit === 'string'
            ? existingData.shipco_parcel_weight_unit
            : null;
    const existingParcelLength = toNumberOrNull(existingData?.shipco_parcel_length);
    const existingParcelWidth = toNumberOrNull(existingData?.shipco_parcel_width);
    const existingParcelHeight = toNumberOrNull(existingData?.shipco_parcel_height);
    const existingParcelDimensionUnit =
        typeof existingData?.shipco_parcel_dimension_unit === 'string'
            ? existingData.shipco_parcel_dimension_unit
            : null;
    const existingShippingCarrier =
        typeof existingData?.shipping_carrier === 'string'
            ? existingData.shipping_carrier
            : null;

    const needsShipcoForTracking =
        !shippingTrackingNumber && !existingData?.shipping_tracking_number;
    const shippingCostEqualsFallback =
        fallbackShippingCost !== null &&
        existingShippingCost !== null &&
        Math.abs(existingShippingCost - fallbackShippingCost) < 0.01;
    const needsShipcoForShippingCost =
        existingShippingCost === null ||
        existingShippingCost === 0 ||
        shippingCostEqualsFallback;
    const needsShipcoForParcel =
        existingParcelWeight === null ||
        existingParcelWeightUnit === null ||
        existingParcelLength === null ||
        existingParcelWidth === null ||
        existingParcelHeight === null ||
        existingParcelDimensionUnit === null;
    const needsShipcoForCarrier = !existingShippingCarrier;

    let shipcoDetails = null;
    if (shouldSkipShipcoIntegration) {
        console.info(
            `[orderService] Ship&Co lookup skipped for order ${order.orderId} because shipping_status is ${shippingStatusRaw || 'unset'}`
        );
    } else if (
        needsShipcoForParcel ||
        needsShipcoForCarrier ||
        (!existingShipcoSyncedAt && (needsShipcoForTracking || needsShipcoForShippingCost))
    ) {
        console.info(
            `[orderService] Attempting Ship&Co lookup for order ${order.orderId}. (trackingNeeded=${needsShipcoForTracking}, shippingCostNeeded=${needsShipcoForShippingCost}, parcelNeeded=${needsShipcoForParcel}, carrierNeeded=${needsShipcoForCarrier})`
        );
        try {
            shipcoDetails = await fetchShipmentDetailsByReference(order.orderId);
        } catch (error) {
            logError('orderService.updateOrderInSupabase.fetchShipmentDetailsByReference', error);
            console.error(
                `[orderService] Ship&Co lookup failed for order ${order.orderId}:`,
                error?.message || error
            );
        }
    }

    let shipcoDataApplied = false;

    if (!shippingTrackingNumber && shipcoDetails?.trackingNumber) {
        shippingTrackingNumber = shipcoDetails.trackingNumber;
        console.info(
            `[orderService] Ship&Co tracking lookup succeeded for order ${order.orderId}: ${shippingTrackingNumber}`
        );
        shipcoDataApplied = true;
    } else if (!shippingTrackingNumber && existingData?.shipping_tracking_number) {
        shippingTrackingNumber = existingData.shipping_tracking_number;
        console.info(
            `[orderService] Using existing shipping tracking number from database for order ${order.orderId}: ${shippingTrackingNumber}`
        );
    } else if (!shippingTrackingNumber) {
        console.warn(
            `[orderService] Ship&Co tracking lookup returned no result for order ${order.orderId}`
        );
    }

    let resolvedShippingCost = existingShippingCost;

    const shipcoRate = toNumberOrNull(shipcoDetails?.deliveryRate);
    const shipcoCurrency = shipcoDetails?.deliveryCurrency || null;
    const isShipcoJpy = shipcoCurrency === null || shipcoCurrency.toUpperCase() === 'JPY';

    if (shipcoRate !== null && isShipcoJpy) {
        resolvedShippingCost = shipcoRate;
        console.info(
            `[orderService] Ship&Co delivery rate applied for order ${order.orderId}: ${shipcoRate} JPY`
        );
        shipcoDataApplied = true;
    } else if (shipcoRate !== null && !isShipcoJpy) {
        console.warn(
            `[orderService] Ship&Co delivery rate currency ${shipcoCurrency} is not JPY for order ${order.orderId}. Shipping cost not updated.`
        );
    }

    if (resolvedShippingCost === null && fallbackShippingCost !== null) {
        resolvedShippingCost = fallbackShippingCost;
    }

    let resolvedEstimatedShippingCost = existingEstimatedShippingCost;
    if (resolvedEstimatedShippingCost === null && fallbackShippingCost !== null) {
        resolvedEstimatedShippingCost = fallbackShippingCost;
    }

    let resolvedParcelWeight = existingParcelWeight;
    let resolvedParcelWeightUnit = existingParcelWeightUnit;
    let resolvedParcelLength = existingParcelLength;
    let resolvedParcelWidth = existingParcelWidth;
    let resolvedParcelHeight = existingParcelHeight;
    let resolvedParcelDimensionUnit = existingParcelDimensionUnit;
    let resolvedShippingCarrier = existingShippingCarrier;

    if (shipcoDetails?.parcel) {
        const parcel = shipcoDetails.parcel;
        if (resolvedParcelWeight === null && parcel.weight !== null) {
            resolvedParcelWeight = parcel.weight;
            shipcoDataApplied = true;
        }
        if (resolvedParcelWeightUnit === null && parcel.weightUnit) {
            resolvedParcelWeightUnit = parcel.weightUnit;
            shipcoDataApplied = true;
        }
        if (resolvedParcelLength === null && parcel.length !== null) {
            resolvedParcelLength = parcel.length;
            shipcoDataApplied = true;
        }
        if (resolvedParcelWidth === null && parcel.width !== null) {
            resolvedParcelWidth = parcel.width;
            shipcoDataApplied = true;
        }
        if (resolvedParcelHeight === null && parcel.height !== null) {
            resolvedParcelHeight = parcel.height;
            shipcoDataApplied = true;
        }
        if (resolvedParcelDimensionUnit === null && parcel.dimensionUnit) {
            resolvedParcelDimensionUnit = parcel.dimensionUnit;
            shipcoDataApplied = true;
        }
    }
    if (!resolvedShippingCarrier && shipcoDetails?.carrier) {
        resolvedShippingCarrier = shipcoDetails.carrier;
        shipcoDataApplied = true;
    }

    const shipcoSyncedAt =
        shipcoDataApplied
            ? new Date().toISOString()
            : existingShipcoSyncedAt || null;

    console.info(
        `[orderService] Order ${order.orderId} earnings summary: earnings=${order.paymentSummary.totalDueSeller.value} ${earningsCurrency || 'USD'}, earnings_after_pl_fee=${earningsAfterPlFee} ${earningsAfterPlFeeCurrency || earningsCurrency || 'USD'}`
    );

    // マージするデータを作成
    const dataToUpsert = {
        order_no: order.orderId,
        order_date: order.creationDate,
        ebay_buyer_id: order.buyer.username,
        buyer_id: buyerId,
        buyer_country_code: order.buyer.buyerRegistrationAddress.contactAddress.countryCode,
        user_id: userId,
        ebay_user_id: order.sellerId,
        ship_to: order.fulfillmentStartInstructions[0].shippingStep.shipTo,
        shipping_deadline: order.lineItems[0].lineItemFulfillmentInstructions.shipByDate,
        ebay_shipment_status: lineItemFulfillmentStatus,
        status: order.orderPaymentStatus,
        total_amount: order.totalFeeBasisAmount.value,
        subtotal: order.pricingSummary.priceSubtotal.value,
        earnings: order.paymentSummary.totalDueSeller.value, // 注文収益
        earnings_after_pl_fee: earningsAfterPlFee,
        shipco_shipping_cost: resolvedShippingCost,
        estimated_shipping_cost: resolvedEstimatedShippingCost,
        shipping_tracking_number:
            shippingTrackingNumber || (existingData ? existingData.shipping_tracking_number : null),
        shipping_carrier: resolvedShippingCarrier,
        shipco_parcel_weight: resolvedParcelWeight,
        shipco_parcel_weight_unit: resolvedParcelWeightUnit,
        shipco_parcel_length: resolvedParcelLength,
        shipco_parcel_width: resolvedParcelWidth,
        shipco_parcel_height: resolvedParcelHeight,
        shipco_parcel_dimension_unit: resolvedParcelDimensionUnit,
        total_amount_currency: totalAmountCurrency,
        subtotal_currency: subtotalCurrency,
        earnings_currency: earningsCurrency,
        earnings_after_pl_fee_currency: earningsAfterPlFeeCurrency,
        shipco_synced_at: shipcoSyncedAt,
        researcher: existingData ? existingData.researcher : researcher
    };

    // Supabaseにデータを保存
    const { data, error } = await supabase
        .from('orders')
        .upsert(dataToUpsert, { onConflict: 'order_no' });

    if (error) {
        console.error('Supabaseでの注文の保存/更新エラー:', error.message);
    }
    return data;
}



// すべての注文とバイヤー情報をSupabaseに保存する関数
async function saveOrdersAndBuyers(userId) {
    const accounts = await fetchEbayAccountTokens(userId);
    for (const account of accounts) {
        const refreshToken = account?.refresh_token;
        const ebayUserId = account?.ebay_user_id || null;
        const accountId = account?.id || null;
        const accountLabel = ebayUserId || (accountId ? `account_id=${accountId}` : 'unknown account');

        let accessToken;
        try {
            accessToken = await refreshEbayToken(refreshToken);
        } catch (tokenError) {
            const errorMessage =
                tokenError?.response?.data?.error_description ||
                tokenError?.response?.data?.error ||
                tokenError?.message ||
                tokenError;
            console.error(
                `[orderService] Token refresh failed for ${accountLabel}:`,
                tokenError?.response?.data || tokenError
            );
            await logError({
                itemId: 'N/A',
                errorType: 'TOKEN_REFRESH_ERROR',
                errorMessage: typeof errorMessage === 'string' ? errorMessage : JSON.stringify(errorMessage),
                attemptNumber: 1,
                additionalInfo: {
                    functionName: 'saveOrdersAndBuyers.refreshEbayToken',
                    ebayUserId,
                    accountId,
                },
            });
            await logSystemError({
                error_code: 'EBAY_TOKEN_REFRESH_FAILED',
                category: 'AUTH',
                severity: 'ERROR',
                provider: 'ebay',
                message: typeof errorMessage === 'string' ? errorMessage : JSON.stringify(errorMessage),
                retryable: false,
                user_id: userId,
                account_id: accountId,
                payload_summary: { ebayUserId },
            });
            continue;
        }

        try {
            const orders = await fetchOrdersFromEbay(accessToken);

            const legacyItemIds = orders.flatMap(order => order.lineItems.map(item => item.legacyItemId));

            const { data: existingOrders, error: existingOrdersError } = await supabase
                .from('orders')
                .select(`
                    order_no,
                    order_line_items (
                        id,
                        legacy_item_id,
                        item_image,
                        stocking_url,
                        cost_price,
                        procurement_tracking_number,
                        procurement_url,
                        procurement_status,
                        researcher
                    )
                `)
                .in('order_no', orders.map(order => order.orderId));

            if (existingOrdersError) {
                console.error('Supabaseからの既存注文の取得エラー:', existingOrdersError.message);
                continue;
            }

            const existingImages = {};
            const existingLineItemData = {};
            existingOrders.forEach(order => {
                order.order_line_items?.forEach(item => {
                    if (item.item_image) {
                        existingImages[item.legacy_item_id] = item.item_image;
                    }
                    existingLineItemData[item.id] = item;
                });
            });

            const { data: itemsData, error: itemsError } = await supabase
                .from('items')
                .select('*')
                .in('ebay_item_id', legacyItemIds);

            if (itemsError) {
                console.error('Supabaseからの商品の取得エラー:', itemsError.message);
                continue;
            }

            const itemsMap = {};
            itemsData.forEach(item => {
                itemsMap[item.ebay_item_id] = item;
            });


            const debugOrderNo = process.env.DEBUG_ORDER_NO || '24-14010-37569';
            for (let order of orders) {
                try {
                    if (order?.orderId === debugOrderNo) {
                        console.info(
                            '[orderService] Debug eBay order payload:',
                            JSON.stringify(order, null, 2)
                        );
                    }
                    const buyer = await fetchAndUpsertBuyer(order, userId);
                    if (!buyer) {
                        console.error("注文に対するバイヤーのアップサート失敗:", order);
                        continue;
                    }

                    const lineItemFulfillmentStatus = order.lineItems?.[0]?.lineItemFulfillmentStatus || 'NOT_STARTED';

                    const lineItems = await fetchAndProcessLineItems(order, accessToken, existingImages, itemsMap);

                    const primaryLineItemId = lineItems[0]?.lineItemId;
                    const primaryLegacyItemId = lineItems[0]?.legacyItemId;
                    const shippingCost = primaryLegacyItemId ? (itemsMap[primaryLegacyItemId]?.estimated_shipping_cost || 0) : 0;

                    const researcher =
                        (primaryLegacyItemId && itemsMap[primaryLegacyItemId]?.researcher) ||
                        (primaryLineItemId && existingLineItemData[primaryLineItemId]?.researcher) ||
                        '';

                    await updateOrderInSupabase(order, buyer.id, userId, lineItems, shippingCost, lineItemFulfillmentStatus, researcher);

                    await upsertOrderLineItems(order, lineItems, researcher);
                } catch (error) {
                    console.log("itemsMap", itemsMap)
                    console.log("order.orderId,", order.orderId)
                    console.error('注文処理エラー:', error);
                    // itemIdを利用できる場合はログに追加
                    const itemId = error?.item?.ItemID?.[0] || 'N/A';

                    await logError({
                        itemId: itemId,  // itemIdをログに追加
                        errorType: 'API_ERROR',
                        errorMessage: error.message,
                        attemptNumber: 1,  // 任意のリトライ回数を指定可能
                        additionalInfo: {
                            functionName: 'saveOrdersAndBuyers',
                            ebayUserId,
                            accountId,
                        }
                    });

                }
            }

            try {
                const marketplaceId = account?.marketplace_id || process.env.EBAY_MARKETPLACE_ID || 'EBAY_US';
                const cancelledOrderNos = await fetchCancelledOrderNosFromEbay(accessToken, marketplaceId);
                if (cancelledOrderNos.length > 0) {
                    let updateQuery = supabase
                        .from('orders')
                        .update({ status: 'CANCELED' })
                        .in('order_no', cancelledOrderNos);
                    if (ebayUserId) {
                        updateQuery = updateQuery.eq('ebay_user_id', ebayUserId);
                    }
                    const { error: cancelUpdateError } = await updateQuery;
                    if (cancelUpdateError) {
                        console.error(
                            '[orderService] Failed to update cancelled orders:',
                            cancelUpdateError.message
                        );
                    } else {
                        console.info(
                            '[orderService] Cancelled orders updated:',
                            `count=${cancelledOrderNos.length}`
                        );
                    }
                } else {
                    console.info('[orderService] No cancellations found for update.');
                }
            } catch (cancelError) {
                console.error(
                    '[orderService] Failed to fetch cancellations:',
                    cancelError?.response?.data || cancelError?.message || cancelError
                );
            }
        } catch (error) {
            console.error(
                `[orderService] Failed to fetch or process orders for ${accountLabel}:`,
                error
            );
            // itemIdを利用できる場合はログに追加
            const itemId = error?.item?.ItemID?.[0] || 'N/A';

            await logError({
                itemId: itemId,  // itemIdをログに追加
                errorType: 'API_ERROR',
                errorMessage: error.message,
                attemptNumber: 1,  // 任意のリトライ回数を指定可能
                additionalInfo: {
                    functionName: 'saveOrdersAndBuyers',
                    ebayUserId,
                    accountId,
                }
            });
        }
    }
}



async function getOrdersByUserId(userId) {
    let { data: orders, error } = await supabase
        .from('orders')
        .select('*, order_line_items(*)')
        .eq('user_id', userId);

    if (error) throw new Error('Failed to fetch orders: ' + error.message);
    const exchangeRates = await loadUserExchangeRates(userId);
    return (orders || [])
        .map(attachNormalizedLineItemsToOrder)
        .map((order) => attachFinancialsToOrder(order, exchangeRates));
};

// ebay上で未発送かつ発送後のmsgを送っていないデータを取得
async function fetchRelevantOrders(userId) {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    const { data, error } = await supabase
        .from('orders')
        .select('*, order_line_items(*)')
        .eq('user_id', userId)
        .or('shipping_status.neq.SHIPPED,delivered_msg_status.neq.SEND')
        .gte('order_date', threeMonthsAgo.toISOString())
        .neq('status', 'FULLY_REFUNDED')
        .neq('status', 'CANCELED')
        .order('order_date', { ascending: false })
        .order('created_at', { ascending: true, foreignTable: 'order_line_items' });

    if (error) {
        console.error('Error fetching relevant orders:', error.message);
        return [];
    }

    const exchangeRates = await loadUserExchangeRates(userId);
    return (data || [])
        .map(attachNormalizedLineItemsToOrder)
        .map((order) => attachFinancialsToOrder(order, exchangeRates));
}

async function fetchArchivedOrders(userId, statusFilter = null) {
    let query = supabase
        .from('orders')
        .select('*, order_line_items(*)')
        .eq('user_id', userId)
        .order('order_date', { ascending: false });

    if (statusFilter) {
        query = query.eq('status', statusFilter);
    } else {
        query = query.in('status', ['CANCELED', 'FULLY_REFUNDED']);
    }

    const { data, error } = await query;
    if (error) {
        console.error('Error fetching archived orders:', error.message);
        return [];
    }

    const exchangeRates = await loadUserExchangeRates(userId);
    return (data || [])
        .map(attachNormalizedLineItemsToOrder)
        .map((order) => attachFinancialsToOrder(order, exchangeRates));
}




// 注文データの更新
async function updateOrder(orderId, orderData) {
    try {
        console.log('Updating order with ID:', orderId); // デバッグ情報を追加
        console.log('Order data to update:', orderData); // デバッグ情報を追加

        const {
            order_line_items: orderLineItemsPayload,
            line_items: legacyLineItemsPayload,
            id: _ignoredId,
            ...rawUpdates
        } = orderData || {};

        const updates = {};
        Object.keys(rawUpdates || {}).forEach((key) => {
            if (rawUpdates[key] !== undefined) {
                updates[key] = rawUpdates[key];
            }
        });
        if (updates.shipping_cost !== undefined && updates.estimated_shipping_cost === undefined) {
            updates.estimated_shipping_cost = updates.shipping_cost;
            delete updates.shipping_cost;
        }

        const toNumberOrNull = (value) => {
            if (value === undefined || value === null || value === '') {
                return null;
            }
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : null;
        };

        if (updates.estimated_shipping_cost !== undefined) {
            updates.estimated_shipping_cost = toNumberOrNull(updates.estimated_shipping_cost);
        }

        const lineItemsPayload = Array.isArray(orderLineItemsPayload)
            ? orderLineItemsPayload
            : Array.isArray(legacyLineItemsPayload)
                ? legacyLineItemsPayload
                : [];

        const lineItemUpdates = lineItemsPayload
            .map((item) => {
                const normalized = normalizeOrderLineItem(item);
                const lineItemId = normalized.id;
                if (!lineItemId) {
                    return null;
                }

                const fields = {};
                if (normalized.cost_price !== undefined) {
                    fields.cost_price = toNumberOrNull(normalized.cost_price);
                }
                if (normalized.stocking_url !== undefined) {
                    fields.stocking_url = normalized.stocking_url || null;
                }
                if (normalized.researcher !== undefined) {
                    fields.researcher = normalized.researcher || null;
                }
                if (normalized.procurement_status !== undefined) {
                    fields.procurement_status = normalized.procurement_status || null;
                }
                if (normalized.procurement_tracking_number !== undefined) {
                    fields.procurement_tracking_number = normalized.procurement_tracking_number || null;
                }
                if (normalized.procurement_site_name !== undefined) {
                    fields.procurement_site_name = normalized.procurement_site_name || null;
                }
                if (normalized.procurement_url !== undefined) {
                    fields.procurement_url = normalized.procurement_url || null;
                }
                if (normalized.quantity !== undefined) {
                    fields.quantity = toNumberOrNull(normalized.quantity);
                }
                if (normalized.total_value !== undefined) {
                    fields.total_value = normalized.total_value === null ? null : toNumberOrNull(normalized.total_value);
                }
                if (normalized.total_currency !== undefined) {
                    fields.total_currency = normalized.total_currency || null;
                }
                if (normalized.line_item_cost_value !== undefined) {
                    fields.line_item_cost_value = normalized.line_item_cost_value === null
                        ? null
                        : toNumberOrNull(normalized.line_item_cost_value);
                }
                if (normalized.line_item_cost_currency !== undefined) {
                    fields.line_item_cost_currency = normalized.line_item_cost_currency || null;
                }
                if (!Object.keys(fields).length) {
                    return null;
                }
                fields.updated_at = new Date().toISOString();
                return { id: lineItemId, fields };
            })
            .filter(Boolean);

        if (Object.keys(updates).length > 0) {
            const { error: orderUpdateError } = await supabase
                .from('orders')
                .update(updates)
                .eq('id', orderId);

            if (orderUpdateError) {
                console.error('Supabase Update Error:', orderUpdateError); // エラー詳細をログに記録
                throw new Error('Failed to update order: ' + orderUpdateError.message);
            }
        }

        if (lineItemUpdates.length > 0) {
            for (const { id, fields } of lineItemUpdates) {
                const { error: lineItemError } = await supabase
                    .from('order_line_items')
                    .update(fields)
                    .eq('id', id);

                if (lineItemError) {
                    console.error('Supabase order_line_items update error:', lineItemError);
                    throw new Error('Failed to update order line items: ' + lineItemError.message);
                }
            }
        }

        const { data: updatedOrder, error: fetchUpdatedError } = await supabase
            .from('orders')
            .select('*, order_line_items(*)')
            .eq('id', orderId)
            .single();

        if (fetchUpdatedError) {
            console.error('Failed to fetch updated order:', fetchUpdatedError);
            throw new Error('Failed to fetch updated order: ' + fetchUpdatedError.message);
        }

        const normalizedOrder = attachNormalizedLineItemsToOrder(updatedOrder);
        const exchangeRates = await loadUserExchangeRates(updatedOrder?.user_id);
        const enrichedOrder = attachFinancialsToOrder(normalizedOrder, exchangeRates);
        console.log('Updated order data:', enrichedOrder); // 成功時のデータをログに記録
        return enrichedOrder;
    } catch (err) {
        console.error('Update Order Service Error:', err); // エラー詳細をログに記録
        throw err;
    }
};

async function uploadTrackingInfoToEbay({
    orderNo,
    trackingNumber,
    carrierCode,
    shippingServiceCode,
    shippedDate,
    lineItems,
}) {
    if (!orderNo) {
        throw new Error('orderNo is required');
    }
    if (!trackingNumber) {
        throw new Error('trackingNumber is required');
    }
    if (!carrierCode) {
        throw new Error('carrierCode is required');
    }

    const { data: order, error: orderFetchError } = await supabase
        .from('orders')
        .select('id, order_no, ebay_user_id, user_id, shipping_status, order_line_items(id, quantity)')
        .eq('order_no', orderNo)
        .single();

    if (orderFetchError || !order) {
        throw new Error('Order not found for tracking upload');
    }

    const refreshToken = await getRefreshTokenByEbayUserId(order.ebay_user_id);
    const accessToken = await refreshEbayToken(refreshToken);

    const resolvedLineItems = Array.isArray(lineItems) && lineItems.length > 0
        ? lineItems
        : (order.order_line_items || []).map((item) => ({
            lineItemId: item.id,
            quantity: item.quantity || 1,
        }));

    const shipmentPayload = {
        trackingNumber,
        shippingCarrierCode: carrierCode,
        lineItems: resolvedLineItems
            .filter((item) => item?.lineItemId)
            .map((item) => ({
                lineItemId: item.lineItemId,
                quantity: item.quantity || 1,
            })),
    };

    if (shipmentPayload.lineItems.length === 0) {
        throw new Error('No line items available for shipment payload');
    }

    if (shippingServiceCode) {
        shipmentPayload.shippingServiceCode = shippingServiceCode;
    }
    if (shippedDate) {
        shipmentPayload.shippedDate = shippedDate;
    }

    let existingFulfillmentId = null;
    try {
        const { data: fulfillmentData } = await axios.get(
            `${EBAY_FULFILLMENT_API_BASE}/order/${orderNo}/shipping_fulfillment`,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
            }
        );
        existingFulfillmentId = fulfillmentData?.fulfillments?.[0]?.fulfillmentId || null;
    } catch (fetchFulfillmentError) {
        const status = fetchFulfillmentError?.response?.status;
        if (status && status !== 404) {
            console.error(
                '[orderService] Failed to fetch existing fulfillments before upload',
                JSON.stringify(
                    {
                        orderNo,
                        status,
                        data: fetchFulfillmentError?.response?.data,
                    },
                    null,
                    2
                )
            );
            throw new Error('Failed to fetch existing fulfillments from eBay');
        }
    }

    if (existingFulfillmentId) {
        try {
            await axios.delete(
                `${EBAY_FULFILLMENT_API_BASE}/order/${orderNo}/shipping_fulfillment/${existingFulfillmentId}`,
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                }
            );
            console.info(
                '[orderService] Existing shipping fulfillment deleted before re-upload',
                JSON.stringify({ orderNo, fulfillmentId: existingFulfillmentId })
            );
        } catch (deleteError) {
            console.error(
                '[orderService] Failed to delete existing shipping fulfillment before re-upload',
                JSON.stringify(
                    {
                        orderNo,
                        fulfillmentId: existingFulfillmentId,
                        status: deleteError?.response?.status,
                        data: deleteError?.response?.data,
                    },
                    null,
                    2
                )
            );
            throw new Error('Failed to delete existing fulfillment before updating tracking');
        }
    }

    const requestConfig = {
        url: `${EBAY_FULFILLMENT_API_BASE}/order/${orderNo}/shipping_fulfillment`,
        method: 'post',
        data: shipmentPayload,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
    };

    try {
        await axios(requestConfig);
    } catch (error) {
        const ebayErrorPayload = error?.response?.data ?? null;
        console.error(
            '[orderService] eBay tracking upload failed',
            JSON.stringify(
                {
                    orderNo,
                    status: error?.response?.status,
                    data: ebayErrorPayload,
                },
                null,
                2
            )
        );
        await logError({
            itemId: orderNo,
            errorType: 'EBAY_TRACKING_UPLOAD_ERROR',
            errorMessage: ebayErrorPayload || error.message,
            attemptNumber: 1,
            additionalInfo: {
                functionName: 'uploadTrackingInfoToEbay',
                orderNo,
                status: error?.response?.status,
            },
        });
        await logSystemError({
            error_code: 'EBAY_TRACKING_UPLOAD_FAILED',
            category: 'EXTERNAL',
            severity: 'ERROR',
            provider: 'ebay',
            message: error.message || 'Failed to upload tracking',
            retryable: true,
            payload_summary: { orderNo },
            details: {
                status: error?.response?.status,
                response: ebayErrorPayload,
            },
        });
        throw new Error('Failed to upload tracking information to eBay');
    }

    const { data: updatedOrder, error: updateError } = await supabase
        .from('orders')
        .update({
            shipping_tracking_number: trackingNumber,
            shipping_status: 'SHIPPED',
        })
        .eq('order_no', orderNo)
        .select('*, order_line_items(*)')
        .single();

    if (updateError) {
        console.error(
            '[orderService] Tracking upload succeeded but failed to update local order',
            JSON.stringify({
                orderNo,
                error: updateError,
            })
        );
        throw new Error('Tracking uploaded but failed to update local order');
    }

    const normalizedOrder = attachNormalizedLineItemsToOrder(updatedOrder);
    const exchangeRates = await loadUserExchangeRates(updatedOrder?.user_id);
    return attachFinancialsToOrder(normalizedOrder, exchangeRates);
}

/**
 * 先週の月曜日から日曜日の範囲を計算する関数
 * @returns {Object} - 先週の開始日と終了日を含むオブジェクト
 */
function getLastWeekDateRange() {
    const now = new Date();
    // 現在の日付から先週の日曜日を取得
    now.setDate(now.getDate() - now.getDay());
    const lastSunday = new Date(now);
    // 先週の月曜日を取得
    now.setDate(now.getDate() - 6);
    const lastMonday = new Date(now);

    // 先週の月曜日の時刻を00:00:00に設定
    lastMonday.setHours(0, 0, 0, 0);
    // 先週の日曜日の時刻を23:59:59に設定
    lastSunday.setHours(23, 59, 59, 999);

    return { start: lastMonday, end: lastSunday };
}

/**
 * 先週の注文を取得する関数
 * @param {number} userId - ユーザーID
 * @returns {Array} - 先週の注文データ
 */
async function fetchLastWeekOrders(userId) {
    const { start, end } = getLastWeekDateRange();
    const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select('*, order_line_items(*)')
        .eq('user_id', userId)
        .gte('order_date', start.toISOString())
        .lte('order_date', end.toISOString())
        .order('order_date', { ascending: false })
        .order('created_at', { ascending: true, foreignTable: 'order_line_items' });

    if (ordersError) {
        console.error('Error fetching last week orders:', ordersError.message);
        return [];
    }

    // 注文に含まれる全てのitemIdを収集
    const normalizedOrders = (orders || []).map(attachNormalizedLineItemsToOrder);
    const exchangeRates = await loadUserExchangeRates(userId);
    const itemIds = [...new Set(normalizedOrders.flatMap(order => order.line_items.map(item => item.legacyItemId)))];

    // 必要なitemIdだけを使ってitemsテーブルからデータを取得
    const { data: items, error: itemsError } = await supabase
        .from('items')
        .select('*')
        .in('ebay_item_id', itemIds);

    if (itemsError) {
        console.error('Error fetching items:', itemsError.message);
        return [];
    }

    // itemsデータをマップに変換
    const itemsMap = {};
    items.forEach(item => {
        itemsMap[item.ebay_item_id] = item;
    });

    // ordersデータにitemsデータを追加
    const enrichedOrders = normalizedOrders.map(order => {
        const enrichedLineItems = order.line_items.map(item => {
            const itemData = itemsMap[item.legacyItemId] || {};
            return { ...item, ...itemData };
        });
        const orderWithItems = { ...order, line_items: enrichedLineItems };
        return attachFinancialsToOrder(orderWithItems, exchangeRates);
    });

    return enrichedOrders;
}

module.exports = {
    fetchOrdersFromEbay,
    saveOrdersAndBuyers,
    getOrdersByUserId,
    fetchRelevantOrders,
    fetchArchivedOrders,
    updateOrder,
    fetchLastWeekOrders,
    updateProcurementStatus,
    updateProcurementTrackingNumber,
    markOrdersAsShipped,
    normalizeOrderLineItem,
    attachNormalizedLineItemsToOrder,
    normalizeProcurementStatusValue,
    uploadTrackingInfoToEbay
};
