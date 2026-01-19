const supabase = require('../supabaseClient');
const { syncCasesForUser } = require('../services/caseService');

/**
 * ケース一覧取得
 * TODO: join orders/buyers/users for richer response
 */
async function listCases(req, res) {
  try {
    const { data, error } = await supabase
      .from('case_records')
      .select('*')
      .order('opened_at', { ascending: false });

    if (error) {
      console.error('Failed to fetch cases:', error.message);
      return res.status(500).json({ message: 'Failed to fetch cases' });
    }

    const rows = data || [];
    const orderNos = Array.from(new Set(
      rows
        .map((row) => row.order_no || row.orderId || row.legacy_order_id || row.legacyOrderId || null)
        .filter(Boolean)
    ));
    let ordersMap = {};
    if (orderNos.length > 0) {
      const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select('order_no, ebay_user_id, line_items, order_line_items(title,item_image)')
        .in('order_no', orderNos);
      if (!ordersError && Array.isArray(orders)) {
        ordersMap = orders.reduce((acc, order) => {
          acc[order.order_no] = order;
          return acc;
        }, {});
      }
    }
    const extractItemInfo = (order) => {
      if (!order) return { item_title: null, item_image: null };
      const lineItems = Array.isArray(order.order_line_items) && order.order_line_items.length
        ? order.order_line_items
        : Array.isArray(order.line_items)
          ? order.line_items
          : [];
      const first = lineItems[0] || {};
      return {
        item_title: first.title || first.item_title || null,
        item_image: first.item_image || first.itemImage || null,
      };
    };
    const enriched = rows.map((row) => {
      const orderNo = row.order_no || row.orderId || row.legacy_order_id || row.legacyOrderId || null;
      const order = orderNo ? ordersMap[orderNo] : null;
      const itemInfo = extractItemInfo(order);
      return {
        ...row,
        order_no: orderNo || row.order_no || null,
        ebay_user_id: order?.ebay_user_id || row.ebay_user_id || null,
        item_title: itemInfo.item_title,
        item_image: itemInfo.item_image,
      };
    });
    return res.json(enriched);
  } catch (err) {
    console.error('Unexpected error fetching cases:', err);
    return res.status(500).json({ message: 'Failed to fetch cases' });
  }
}

/**
 * 手動同期
 * 現時点ではプレースホルダー: 将来 eBay API から取得し case_records を更新する。
 */
async function syncCases(req, res) {
  try {
    const userId = Number(req.query.userId || 2); // TODO: auth middlewareから取得
    const synced = await syncCasesForUser(userId);
    return res.json(synced || []);
  } catch (err) {
    console.error('Unexpected error syncing cases:', err?.response?.data || err);
    const status = err?.response?.status || 500;
    return res.status(status).json({ message: err?.message || 'Failed to sync cases' });
  }
}

module.exports = {
  listCases,
  syncCases
};
