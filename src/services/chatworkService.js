const axios = require('axios');
const supabase = require('../supabaseClient');
const orderService = require('./orderService');

async function fetchItemsByLegacyItemIds(legacyItemIds) {
    const { data: items, error } = await supabase
        .from('items')
        .select('*')
        .in('ebay_item_id', legacyItemIds); // legacyItemIdに一致するアイテムのみを取得
    if (error) throw new Error('Failed to fetch items: ' + error.message);
    return items;
}

function sendChatworkMessage(token, roomId, messageBody) {
    if (!token || !roomId || !messageBody) {
        throw new Error('Chatwork token, roomId, and messageBody are required');
    }
    const endpoint = `https://api.chatwork.com/v2/rooms/${roomId}/messages`;
    const options = {
        method: "post",
        headers: {
            "X-ChatWorkToken": token,
            "Content-Type": "application/x-www-form-urlencoded"
        },
        data: `body=${encodeURIComponent(messageBody)}`
    };
    return axios(endpoint, options);
}

async function createWeeklySalesMessage(userId, token, roomId) {
    const orders = await orderService.fetchLastWeekOrders(userId);

    // ordersからlegacyItemIdのリストを作成
    const legacyItemIds = orders.flatMap(order => order.line_items.map(line_item => line_item.legacyItemId));

    // legacyItemIdに一致するitemsを取得
    const items = await fetchItemsByLegacyItemIds(legacyItemIds);

    // 商品情報をマップに変換
    let productInfoMap = {};
    items.forEach(item => {
        const itemId = item.ebay_item_id;
        if (item.researcher !== "ツール") {
            productInfoMap[itemId] = {
                title: item.title || null,
                researcher: item.researcher || "???",
                exhibitor: item.exhibitor || "???",
                ebayURL: "https://www.ebay.com/itm/" + itemId
            };
        }
    });

    // メッセージを組み立てる
    let messageBody = "[toall]\n皆さんお疲れ様です(bow)\n先週もたくさんの注文がありましたので共有します！\n\n(*)先週売れた商品(*)\n";
    orders.forEach(order => {
        const lineItem = order.line_items[0];
        const productInfo = productInfoMap[order.line_items[0].legacyItemId];
        if (productInfo) {
            const title = productInfo.title || lineItem.title || "???";
            messageBody += `【${title}】\n${productInfo.ebayURL}\nリサーチ担当: ${productInfo.researcher}さん\t出品担当: ${productInfo.exhibitor}さん\n\n`;
        }
    });

    messageBody += "\nリサーチされた方、おめでとうございます(cracker)\nまた、出品された方も丁寧な作業ありがとうございます！！\n皆さんのおかげで素晴らしい成果が得られました(clap)\nリサーチされた方は売れた商品を深掘りして、関連品や限定品・セット品など、より利益を狙える商品を探していきましょう(gogo)\n\n引き続きよろしくお願いいたします(bow)\n\n※「???」はebayサイトの都合上反映されない場合があるため商品ページの確認または山本までご連絡ください。";

    await sendChatworkMessage(token, roomId, messageBody);
}

const formatDateLabel = (value) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const STATUS_GROUP_CONFIG = {
    STOCKED_SHIPPED: {
        heading: '■ 配送確認が必要',
        reason: '発送期限が近い注文です。配送状況を確認してください。',
        supplierFromUrl: true,
        sortOrder: 0,
    },
    ORDERED: {
        heading: '■ 発送確認が必要',
        reason: '発注から3日経過しています。発送状況を確認してください。',
        supplierFromUrl: true,
        sortOrder: 1,
    },
    OUTOFSTOCK: {
        heading: '■ 欠品確認が必要',
        reason: '注文から3日経過しています。在庫状況を確認してください。',
        supplierFromUrl: false,
        sortOrder: 2,
    },
    NEW: {
        heading: '■ 仕入確認が必要',
        reason: '注文から3日経過しています。仕入れを行ってください。',
        supplierFromUrl: false,
        sortOrder: 3,
    },
};

function detectSupplierNameFromUrl(url) {
    if (!url || typeof url !== 'string') {
        return null;
    }
    let hostname = '';
    try {
        hostname = new URL(url).hostname.toLowerCase();
    } catch (_error) {
        return null;
    }

    if (hostname.includes('mercari.com')) return 'メルカリ';
    if (hostname.includes('paypayfleamarket.yahoo.co.jp')) return 'Yahooフリマ';
    if (hostname.includes('auctions.yahoo.co.jp') || hostname.includes('page.auctions.yahoo.co.jp')) return 'ヤフオク';
    if (hostname.includes('rakuten')) return '楽天';
    if (hostname.includes('amazon')) return 'Amazon';
    if (hostname.includes('suruga-ya')) return '駿河屋';
    if (hostname.includes('geo-online')) return 'ゲオ';
    if (hostname.includes('bookoffonline')) return 'ブックオフ';
    if (hostname.includes('paypaymall')) return 'PayPayモール';
    return hostname.replace(/^www\./, '') || null;
}

function getProcurementEntries(lineItem = {}) {
    if (Array.isArray(lineItem.procurement_entries) && lineItem.procurement_entries.length > 0) {
        return lineItem.procurement_entries;
    }
    if (Array.isArray(lineItem.procurementEntries) && lineItem.procurementEntries.length > 0) {
        return lineItem.procurementEntries;
    }
    const fallbackUrl = lineItem.procurement_url || lineItem.stocking_url || null;
    if (!fallbackUrl) return [];
    return [{ url: fallbackUrl }];
}

function resolveSupplierGroupLabel(lineItem, status) {
    const config = STATUS_GROUP_CONFIG[status];
    if (!config?.supplierFromUrl) {
        return '仕入れ先不明';
    }
    const supplierNames = Array.from(
        new Set(
            getProcurementEntries(lineItem)
                .map((entry) => detectSupplierNameFromUrl(entry?.url))
                .filter(Boolean)
        )
    );
    if (supplierNames.length === 0) {
        return '仕入れ先不明';
    }
    if (supplierNames.length === 1) {
        return supplierNames[0];
    }
    return '複数';
}

function buildProcurementAlertMessage(alerts) {
    const header = '[toall]\n【要対応注文通知】\n\n';
    const sections = new Map();

    alerts.forEach((alert) => {
        (alert.lineItems || []).forEach((lineItem) => {
            const status = lineItem.currentStatus;
            const config = STATUS_GROUP_CONFIG[status];
            if (!config) return;
            const supplierLabel = resolveSupplierGroupLabel(lineItem, status);
            const sectionKey = status;
            if (!sections.has(sectionKey)) {
                sections.set(sectionKey, {
                    ...config,
                    suppliers: new Map(),
                });
            }
            const section = sections.get(sectionKey);
            if (!section.suppliers.has(supplierLabel)) {
                section.suppliers.set(supplierLabel, new Map());
            }
            const supplierBucket = section.suppliers.get(supplierLabel);
            const orderKey = `${alert.orderNo}::${alert.ebayUserId || '-'}`;
            if (!supplierBucket.has(orderKey)) {
                supplierBucket.set(orderKey, {
                    orderNo: alert.orderNo,
                    ebayUserId: alert.ebayUserId || '-',
                    details: [],
                });
            }
            const orderEntry = supplierBucket.get(orderKey);
            if (lineItem.currentStatusLabel && !orderEntry.details.includes(lineItem.currentStatusLabel)) {
                orderEntry.details.push(lineItem.currentStatusLabel);
            }
        });
    });

    const orderedSections = Array.from(sections.entries())
        .sort(([, a], [, b]) => a.sortOrder - b.sortOrder)
        .map(([, value]) => value);

    let body = header;
    orderedSections.forEach((section, sectionIndex) => {
        if (sectionIndex > 0) body += '\n';
        const supplierCount = Array.from(section.suppliers.values()).reduce((sum, bucket) => sum + bucket.size, 0);
        body += `${section.heading}（${supplierCount}件）\n${section.reason}\n\n`;

        const orderedSuppliers = Array.from(section.suppliers.entries())
            .sort(([a], [b]) => a.localeCompare(b, 'ja'));

        orderedSuppliers.forEach(([supplierLabel, ordersMap], supplierIndex) => {
            if (supplierIndex > 0) body += '\n';
            body += `[${supplierLabel}] ${ordersMap.size}件\n`;
            Array.from(ordersMap.values())
                .sort((a, b) => String(a.orderNo).localeCompare(String(b.orderNo), 'en'))
                .forEach((entry) => {
                    const detailText = entry.details.length > 1
                        ? ` | 明細: ${entry.details.join(', ')}`
                        : '';
                    body += `・${entry.orderNo} | ${entry.ebayUserId}${detailText}\n`;
                });
        });
    });

    return body.trim();
}

async function sendProcurementAlertSummary(userId, token, roomId) {
    const alerts = await orderService.getProcurementAlertCandidates(userId);
    if (!alerts.length) {
        return { sent: false, alertCount: 0 };
    }

    const maxBodyLength = 9000;
    let messageBody = buildProcurementAlertMessage(alerts);

    if (messageBody.length > maxBodyLength) {
        messageBody = `${messageBody.slice(0, maxBodyLength - 40)}\n\n詳細はBayworkで確認してください。`;
    }

    await sendChatworkMessage(token, roomId, messageBody.trim());
    return { sent: true, alertCount: alerts.length };
}

module.exports = {
    createWeeklySalesMessage,
    sendChatworkMessage,
    sendProcurementAlertSummary,
};
