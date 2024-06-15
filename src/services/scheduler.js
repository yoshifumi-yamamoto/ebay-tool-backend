const cron = require('node-cron');
const { refreshAccessToken } = require('./octoparseService');
const supabase = require('../supabaseClient');

/**
 * 定期的にOctoparseのアクセストークンをリフレッシュする関数
 */
const scheduleTokenRefresh = () => {
  cron.schedule('0 0 * * *', async () => { // 毎日深夜0時に実行
    const { data: accounts, error } = await supabase
      .from('octoparse_accounts')
      .select('user_id, refresh_token');
    
    if (error) {
      console.error('Error fetching Octoparse accounts:', error);
      return;
    }

    for (const account of accounts) {
      try {
        await refreshAccessToken(account.refresh_token, account.user_id);
      } catch (error) {
        console.error('Error refreshing token for user:', account.user_id, error);
      }
    }
  });
};

module.exports = { scheduleTokenRefresh };
