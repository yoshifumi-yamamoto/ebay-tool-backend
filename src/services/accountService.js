const supabase = require('../supabaseClient');

exports.createAccount = async (accountData) => {
    const { data, error } = await supabase
        .from('accounts')
        .insert([accountData]);
    if (error) throw new Error('Failed to create account: ' + error.message);
    return data;
};

exports.getAccountsByUserId = async (userId) => {
    const { data, error } = await supabase
        .from('accounts')
        .select('*')
        .eq('user_id', userId);
    if (error) throw new Error('Failed to retrieve accounts: ' + error.message);
    return data;
};

exports.updateAccount = async (id, accountData) => {
    const { data, error } = await supabase
        .from('accounts')
        .update(accountData)
        .eq('id', id);
    if (error) throw new Error('Failed to update account: ' + error.message);
    return data;
};

exports.deleteAccount = async (id) => {
    const { data, error } = await supabase
        .from('accounts')
        .delete()
        .eq('id', id);
    if (error) throw new Error('Failed to delete account: ' + error.message);
    return data;
};
