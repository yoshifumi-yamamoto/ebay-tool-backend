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

    return res.json(data || []);
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
