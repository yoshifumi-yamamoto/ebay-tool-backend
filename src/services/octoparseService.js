const axios = require('axios');
const supabase = require('../supabaseClient');
const octoparseTaskModel = require('../models/octoparseTaskModel');

// 特定のユーザーIDに基づいてユーザー名とパスワードを取得
const getCredentialsFromSupabase = async (userId) => {

  try {
    const { data, error } = await supabase
      .from('octoparse_accounts')
      .select('username, password, refresh_token, access_token')
      .eq('user_id', userId)
      .single();

    if (error) {
      console.error('Error fetching credentials from Supabase:', error);
      throw error;
    }

    return data;
  } catch (error) {
    console.error('Error fetching credentials:', error);
    throw error;
  }
};

// リフレッシュトークンを使ってアクセストークンを取得
const getAccessTokenWithRefreshToken = async (refreshToken) => {
  try {
    const response = await axios.post('https://openapi.octoparse.com/token', {
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    }, {
      headers: { 'Content-Type': 'application/json' }
    });

    return response.data.data.access_token;
  } catch (error) {
    if (error.response && error.response.status === 400) {
      console.error('Refresh token is invalid or expired:', error.response.data);
    } else {
      console.error('Error obtaining access token with refresh token:', error.response.data);
    }
    throw error;
  }
};

// ユーザー名とパスワードを使って新しいリフレッシュトークンとアクセストークンを取得
const getNewTokensWithCredentials = async (username, password) => {
  try {
    const response = await axios.post('https://openapi.octoparse.com/token', {
      username: username,
      password: password,
      grant_type: 'password'
    }, {
      headers: { 'Content-Type': 'application/json' }
    });

    return {
      accessToken: response.data.data.access_token,
      refreshToken: response.data.data.refresh_token
    };
  } catch (error) {
    console.error('Error obtaining new tokens with credentials:', error.response.data);
    throw error;
  }
};

// 新しいトークンをSupabaseに保存
const saveNewTokensToSupabase = async (userId, newAccessToken, newRefreshToken) => {
  const currentTime = new Date().toISOString();

  try {
    const { data, error } = await supabase
      .from('octoparse_accounts')
      .update({
        access_token: newAccessToken,
        refresh_token: newRefreshToken,
        access_token_updated_at: currentTime
      })
      .eq('user_id', userId);

    if (error) {
      console.error('Error updating tokens in Supabase:', error);
      throw error;
    }

  } catch (error) {
    console.error('Error updating tokens in Supabase:', error);
    throw error;
  }
};

// トークンをリフレッシュする関数
const refreshOctoparseToken = async (userId, refreshToken) => {

  try {
    // まず、リフレッシュトークンからアクセストークンを取得
    const newAccessToken = await getAccessTokenWithRefreshToken(refreshToken);
    return newAccessToken;
  } catch (error) {
    if (error.response && error.response.status === 400) {
      // リフレッシュトークンが無効または期限切れの場合、新しいトークンを取得
      const { username, password } = await getCredentialsFromSupabase(userId);
      const { accessToken, refreshToken: newRefreshToken } = await getNewTokensWithCredentials(username, password);

      // 新しいトークンをSupabaseに保存
      await saveNewTokensToSupabase(userId, accessToken, newRefreshToken);

      return accessToken;
    } else {
      throw error;
    }
  }
};

// Octoparseのデータを取得する関数
const fetchAllOctoparseData = async (userId, taskId) => {
  let { access_token, refresh_token } = await getCredentialsFromSupabase(userId);
  const baseUrl = `https://openapi.octoparse.com/data/all`;
  let allData = [];
  let offset = 0;
  const size = 1000;
  const maxRetries = 3; // トークンリフレッシュの最大試行回数
  let retryCount = 0;

  while (true) {
    try {
      const response = await axios.get(baseUrl, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${access_token}`
        },
        params: { taskId, offset, size }
      });

      const responseData = response.data.data;

      if (responseData && responseData.data && responseData.data.length > 0) {
        allData.push(...responseData.data);
        offset = responseData.offset;  
      } else {
        break;
      }

      if (responseData.restTotal === 0) {
        break;
      }

    } catch (error) {

      if ((error.response && (error.response.status === 401 || error.response.status === 403)) && retryCount < maxRetries) {
        console.log(`Attempting to refresh token... Retry count: ${retryCount}`);
        retryCount++;
        try {
          const newAccessToken = await refreshOctoparseToken(userId, refresh_token);  // userIdとrefresh_tokenを渡す

          await supabase
            .from('octoparse_accounts')
            .update({ access_token: newAccessToken })
            .eq('user_id', userId);

          access_token = newAccessToken;
        } catch (refreshError) {
          console.error('Failed to refresh token:', refreshError.message);
          throw new Error(`Failed to refresh token: ${refreshError.message}`);
        }
      } else {
        throw new Error(`Error fetching data from Octoparse: ${error.message}`);
      }
    }
  }

  return allData;
};

// Octoparseのデータを削除する関数
const deleteOctoparseData = async (userId, taskId) => {
  let { access_token, refresh_token } = await getCredentialsFromSupabase(userId);
  const maxRetries = 3; // トークンリフレッシュの最大試行回数
  let retryCount = 0;

  try {
    const response = await axios.post('https://openapi.octoparse.com/data/remove', {
      taskId
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${access_token}`
      }
    });

    if (response.data && response.data.code === 0) {
      console.log('Data successfully deleted from Octoparse.');
    } else {
      console.error('Failed to delete data from Octoparse:', response.data);
    }
  } catch (error) {
    console.log("deleteOctoparseData error");
    console.log("Error details:", error.response ? error.response.data : error.message);

    if ((error.response && (error.response.status === 401 || error.response.status === 403)) && retryCount < maxRetries) {
      console.log(`Attempting to refresh token... Retry count: ${retryCount}`);
      retryCount++;
      try {
        const newAccessToken = await refreshOctoparseToken(userId, refresh_token);  // userIdとrefresh_tokenを渡す
        await supabase
          .from('octoparse_accounts')
          .update({ access_token: newAccessToken })
          .eq('user_id', userId);

        access_token = newAccessToken;
        await deleteOctoparseData(userId, taskId);  // トークン更新後に再試行
      } catch (refreshError) {
        console.error('Failed to refresh token:', refreshError.message);
        throw new Error(`Failed to refresh token: ${refreshError.message}`);
      }
    } else {
      throw new Error(`Error deleting data from Octoparse: ${error.message}`);
    }
  }
};

// 在庫管理フラグを更新するサービス関数
const updateInventoryManagementFlag = async (taskId, enabled) => {
    return await octoparseTaskModel.updateInventoryManagementFlag(taskId, enabled);
};

// user_idに紐づくタスクを取得
const getTasksForUser = async (userId) => {
  const { data, error } = await supabase
      .from('octoparse_tasks')
      .select('task_id, task_name')
      .eq('user_id', userId);

  if (error) throw error;
  return data;
};

// task_delete_flgを更新する関数
const updateTaskDeleteFlag = async (taskId, deleteFlag) => {
  try {
    const { data, error } = await supabase
      .from('inventory_management_schedules')
      .update({ task_delete_flg: deleteFlag })
      .eq('task_id', taskId);

    if (error) {
      throw error;
    }
    return data;
  } catch (error) {
    console.error('Error updating task_delete_flg:', error.message);
    throw error;
  }
};

module.exports = { fetchAllOctoparseData, updateInventoryManagementFlag, getTasksForUser, deleteOctoparseData, updateTaskDeleteFlag };
