const supabase = require('../supabaseClient');

const listCountryCodes = async () => {
  const { data, error } = await supabase
    .from('country_codes')
    .select('code, name_ja, name_en, currency, ebay_currency')
    .order('code', { ascending: true });
  if (error) {
    throw new Error(`Failed to fetch country codes: ${error.message}`);
  }
  return data || [];
};

module.exports = {
  listCountryCodes,
};
