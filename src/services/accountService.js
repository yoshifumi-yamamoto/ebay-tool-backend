const supabase = require('../supabaseClient');

exports.addAccount = async ({ user_id, ebay_user_id, token, token_expiration }) => {
    const { data, error } = await supabase
        .from('accounts')
        .insert([{ user_id, ebay_user_id, token, token_expiration }]);

    if (error) throw new Error(error.message);
    return data;
};

exports.getAccounts = async () => {
    const { data, error } = await supabase
        .from('accounts')
        .select('*');

    if (error) throw new Error(error.message);
    return data;
};
