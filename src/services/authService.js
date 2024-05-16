require('dotenv').config();
const supabase = require('../supabaseClient');



const getEbayUserToken = async (userId) => {
  const { data, error } = await supabase
    .from('accounts')
    .select('access_token')
    .eq('user_id', userId);

  if (error) {
    console.error('Failed to fetch eBay account tokens:', error.message);
    throw error;
  }
  return data.map(account => account.access_token);
};

module.exports = {
  getEbayUserToken
};
