const listingService = require('../services/listingService');

// リスティングを同期するエンドポイントのコントローラー関数
async function syncListings(req, res) {
  const userId = req.query.userId; // クエリパラメータからuserIdを取得

  if (!userId) {
      return res.status(400).send('User ID is required');
  }

  try {
      await listingService.syncListingsForUser(userId);
      res.status(200).send('Listings synced successfully');
  } catch (error) {
      console.error('Error syncing listings:', error);
      res.status(500).send('Error syncing listings');
  }
}


module.exports = {
    syncListings,
};
