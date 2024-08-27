const supabase = require('../supabaseClient');
const ebayApi = require('./ebayApi');

async function syncListingsForUser(userId) {
  const { data: accounts, error: accountsError } = await supabase
      .from('accounts')
      .select('refresh_token, ebay_user_id')
      .eq('user_id', userId);

  if (accountsError) {
      console.error('Error fetching accounts from Supabase:', accountsError.message);
      throw new Error('Failed to fetch accounts from database');
  }

  if (accounts.length === 0) {
      throw new Error('No eBay accounts found for the given user ID');
  }

  let apiCallCount = 0; // API呼び出し回数をカウント
  let totalWritesToSupabase = 0; // Supabaseへの書き込み回数をカウント
  let activeCount = 0; // Activeリスティングの件数
  let unsoldCount = 0; // Unsoldリスティングの件数

  for (const account of accounts) {
      const refreshToken = account.refresh_token;
      const ebayUserId = account.ebay_user_id;
      const failedItems = []; // 失敗したitemIdを格納する配列

      try {
          const authToken = await ebayApi.refreshEbayToken(refreshToken);
          
          // API呼び出しの時間計測開始
          const apiStartTime = Date.now();
          const firstPageData = await ebayApi.fetchListingsByStatus(authToken, 1, 100);
          apiCallCount++; // API呼び出し回数をインクリメント
          const apiEndTime = Date.now();
          console.log(`API call took ${apiEndTime - apiStartTime}ms`); // API呼び出し時間をログに出力

          const listings = firstPageData.listings;

          // Supabase書き込みの時間計測開始
          const supabaseStartTime = Date.now();
          const writeResults = await updateItemsTableWithListings(listings, ebayUserId, failedItems);
          totalWritesToSupabase += writeResults.totalWrites;
          activeCount += writeResults.activeWrites;
          unsoldCount += writeResults.unsoldWrites;
          const supabaseEndTime = Date.now();
          console.log(`Supabase writes took ${supabaseEndTime - supabaseStartTime}ms`); // Supabase書き込み時間をログに出力

          const totalPages = Math.ceil(firstPageData.totalEntries / 100);

          for (let pageNumber = 2; pageNumber <= totalPages; pageNumber++) {
              // API呼び出しの時間計測
              const pageApiStartTime = Date.now();
              const pageData = await ebayApi.fetchListingsByStatus(authToken, pageNumber, 100);
              apiCallCount++; // API呼び出し回数をインクリメント
              const pageApiEndTime = Date.now();
              console.log(`API call (page ${pageNumber}) took ${pageApiEndTime - pageApiStartTime}ms`);

              const pageListings = pageData.listings;

              // Supabase書き込みの時間計測
              const pageSupabaseStartTime = Date.now();
              const pageWriteResults = await updateItemsTableWithListings(pageListings, ebayUserId, failedItems);
              totalWritesToSupabase += pageWriteResults.totalWrites;
              activeCount += pageWriteResults.activeWrites;
              unsoldCount += pageWriteResults.unsoldWrites;
              const pageSupabaseEndTime = Date.now();
              console.log(`Supabase writes (page ${pageNumber}) took ${pageSupabaseEndTime - pageSupabaseStartTime}ms`);
          }
      } catch (error) {
          console.error('Error during token refresh or fetching listings:', error.message);
      }

      // アカウントごとに失敗したアイテムIDを出力
      if (failedItems.length > 0) {
          console.error(`Failed to update items for eBay user ID ${ebayUserId}: ${failedItems.join(', ')}`);
      } else {
          console.log(`All items updated successfully for eBay user ID ${ebayUserId}.`);
      }
  }

  // API呼び出し回数とSupabaseへの書き込み回数をログに出力
  console.log(`Total API calls: ${apiCallCount}`);
  console.log(`Total writes to Supabase: ${totalWritesToSupabase}`);
  console.log(`Active listings written to Supabase: ${activeCount}`);
  console.log(`Unsold listings written to Supabase: ${unsoldCount}`);
}

async function updateItemsTableWithListings(listings, ebayUserId, failedItems) {
  const syncedAt = new Date().toISOString(); // 同期した日時を取得

  // データ整形前のログ出力
  console.log(`Total listings before deduplication: ${listings.length}`);

  // `ebay_item_id`がユニークになるように重複を削除
  const uniqueListings = Array.from(new Set(listings.map(listing => listing.itemId)))
    .map(itemId => {
        return listings.find(listing => listing.itemId === itemId);
    });

  // データ整形後のログ出力
  console.log(`Total unique listings after deduplication: ${uniqueListings.length}`);

  const updates = uniqueListings.map(listing => {
      return {
          ebay_item_id: listing.itemId,
          ebay_user_id: ebayUserId,
          listing_status: listing.status,
          status_synced_at: syncedAt, 
          // userから取得するように要修正！！
          user_id: 2
      };
  });

  // 送信前に件数をログ出力
  console.log(`Preparing to upsert ${updates.length} listings to Supabase`);

  try {
      // バッチで更新操作を実行
      const { data, error } = await supabase.from('items').upsert(updates, { onConflict: ['ebay_item_id', 'ebay_user_id'] });

      if (error) {
          console.error(`Supabase upsert error: ${error.message}`, error.details);
          failedItems.push(...updates.map(u => u.ebay_item_id));
          throw error;
      }

      // Supabaseがnullを返した場合のログ
      if (!data) {
          console.log('Supabase upsert returned null data. This might indicate no changes were made.');
      } else {
          console.log(`Successfully upserted ${data.length} listings to Supabase`);
      }
      
      // 成功した書き込みのカウントを更新
      const activeWrites = updates.filter(u => u.listing_status === 'ACTIVE').length;
      const unsoldWrites = updates.filter(u => u.listing_status === 'ENDED').length;
      
      return {
          totalWrites: updates.length,
          activeWrites,
          unsoldWrites
      };
  } catch (error) {
      console.error(`Error updating items in Supabase:`, error.message);
      return { totalWrites: 0, activeWrites: 0, unsoldWrites: 0 };
  }
}






module.exports = {
    syncListingsForUser,
};
