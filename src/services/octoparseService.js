const axios = require('axios');
const supabase = require('../supabaseClient');
const octoparseTaskModel = require('../models/octoparseTaskModel');

const getOctoparseToken = async (userId) => {
  const { data, error } = await supabase
    .from('octoparse_accounts')
    .select('access_token, refresh_token')
    .eq('user_id', userId)
    .single();

  if (error) throw error;
  return data;
};

const refreshOctoparseToken = async (refreshToken) => {
  const response = await axios.post('https://openapi.octoparse.com/token', {
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  }, {
    headers: { 'Content-Type': 'application/json' }
  });

  return response.data.access_token;
};

const fetchAllOctoparseData = async (userId, taskId) => {
  let { access_token, refresh_token } = await getOctoparseToken(userId);

  const baseUrl = `https://openapi.octoparse.com/data/all`;
  let allData = [];
  let offset = 0;
  const size = 1000;

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
      if (error.response && error.response.status === 401) {
        access_token = await refreshOctoparseToken(refresh_token);
        await supabase
          .from('octoparse_accounts')
          .update({ access_token })
          .eq('user_id', userId);
      } else {
        throw new Error(`Error fetching data from Octoparse: ${error.message}`);
      }
    }
  }

  return allData;
};


// 在庫管理フラグを更新するサービス関数
const updateInventoryManagementFlag = async (taskId, enabled) => {
    return await octoparseTaskModel.updateInventoryManagementFlag(taskId, enabled);
};


module.exports = { fetchAllOctoparseData, updateInventoryManagementFlag };
