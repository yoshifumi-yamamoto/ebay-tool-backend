// src/models/octoparseAccountModel.js
const supabase = require('../supabaseClient');

/**
 * ユーザーIDでOctoparseアカウントを取得する関数
 * @param {string} userId - ユーザーID
 * @returns {Promise<object>} - Octoparseアカウントデータ
 */
const getOctoparseAccount = async (userId) => {
    const { data, error } = await supabase
        .from('octoparse_accounts')
        .select('*')
        .eq('user_id', userId)
        .single();

    if (error) throw error;
    return data;
};

/**
 * Octoparseアカウントのアクセストークンを更新する関数
 * @param {string} userId - ユーザーID
 * @param {string} accessToken - 新しいアクセストークン
 * @param {string} expiresIn - 新しいアクセストークンの有効期限
 * @returns {Promise<void>}
 */
const updateOctoparseAccount = async (userId, accessToken, expiresIn) => {
    const { error } = await supabase
        .from('octoparse_accounts')
        .update({ access_token: accessToken, expires_in: expiresIn })
        .eq('user_id', userId);

    if (error) throw error;
};

module.exports = { getOctoparseAccount, updateOctoparseAccount };
