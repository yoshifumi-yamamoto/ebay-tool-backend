const listingService = require('../services/listingService');

// リスティングを同期するエンドポイントのコントローラー関数
async function syncListings(req, res) {
    console.log("syncListings")
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

// リスティングを同期するエンドポイントのコントローラー関数
async function syncEndedListings(req, res) {
    console.log("syncEndedListings")
  const userId = req.query.userId; // クエリパラメータからuserIdを取得

  if (!userId) {
      return res.status(400).send('User ID is required');
  }

  try {
      await listingService.updateSupabaseWithEndedListings(userId);
      res.status(200).send('endedListings synced successfully');
  } catch (error) {
      console.error('Error syncing listings:', error);
      res.status(500).send('Error syncing listings');
  }
}


module.exports = {
    syncListings,
    syncEndedListings
};
