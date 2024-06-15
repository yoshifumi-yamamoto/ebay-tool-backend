const axios = require('axios');
const { getOctoparseAccount, updateOctoparseAccount } = require('../models/octoparseAccountModel');

/**
 * Octoparseからデータを取得する関数
 * @param {string} userId - ユーザーID
 * @param {string} taskID - OctoparseのタスクID
 * @returns {Promise<object>} - 取得したデータ
 */
const getScrapedData = async (userId, taskID) => {
  try {
    const account = await getOctoparseAccount(userId);
    const response = await axios.get(`https://dataapi.octoparse.com/api/task/${taskID}/data`, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${account.access_token}`
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching data from Octoparse:', error);
    throw error;
  }
};

/**
 * Octoparseのタスクステータスを確認する関数
 * @param {string} userId - ユーザーID
 * @param {string} taskID - OctoparseのタスクID
 * @returns {Promise<boolean>} - タスクが完了しているかどうか
 */
const checkTaskCompletion = async (userId, taskID) => {
  try {
    const account = await getOctoparseAccount(userId);
    const response = await axios.get(`https://dataapi.octoparse.com/api/task/${taskID}/status`, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${account.access_token}`
      }
    });
    return response.data.status === 'Completed';
  } catch (error) {
    console.error('Error checking task status in Octoparse:', error);
    throw error;
  }
};

/**
 * Octoparseのアクセストークンをリフレッシュする関数
 * @param {string} refreshToken - Octoparseのリフレッシュトークン
 * @param {string} userId - ユーザーID
 * @returns {Promise<string>} - 新しいアクセストークン
 */
const refreshAccessToken = async (refreshToken, userId) => {
  try {
    const response = await axios.post('https://dataapi.octoparse.com/api/user/refreshToken', {
      refresh_token: refreshToken
    });
    const { access_token, expires_in } = response.data;
    await updateOctoparseAccount(userId, access_token, expires_in);
    return access_token;
  } catch (error) {
    console.error('Error refreshing Octoparse access token:', error);
    throw error;
  }
};

module.exports = { getScrapedData, checkTaskCompletion, refreshAccessToken };
