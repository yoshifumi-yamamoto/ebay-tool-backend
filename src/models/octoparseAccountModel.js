const supabase = require('../supabaseClient');

/**
 * Octoparseアカウント情報を取得する関数
 * @param {string} userId - ユーザーID
 * @returns {Promise<object>} - 取得されたアカウントデータ
 */
const getOctoparseAccount = async (userId) => {
  try {
    const { data, error } = await supabase
      .from('octoparse_accounts')
      .select('*')
      .eq('user_id', userId)
      .single();
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error fetching Octoparse account:', error);
    throw error;
  }
};

/**
 * Octoparseアカウント情報を更新する関数
 * @param {string} userId - ユーザーID
 * @param {string} accessToken - Octoparseのアクセストークン
 * @param {number} expiresIn - アクセストークンの有効期限（秒単位）
 * @returns {Promise<object>} - 更新されたデータ
 */
const updateOctoparseAccount = async (userId, accessToken, expiresIn) => {
  try {
    const { data, error } = await supabase
      .from('octoparse_accounts')
      .update({ access_token: accessToken, expires_in: expiresIn, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error updating Octoparse account:', error);
    throw error;
  }
};

module.exports = { getOctoparseAccount, updateOctoparseAccount };
