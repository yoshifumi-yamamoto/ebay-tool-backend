const supabase = require('../supabaseClient');
const bcrypt = require('bcryptjs');

exports.createUser = async (userData) => {
    const hashedPassword = await bcrypt.hash(userData.password, 10);
    userData.password = hashedPassword;
    const { data, error } = await supabase
        .from('users')
        .insert([
            { ...userData }
        ]);
    if (error) throw new Error(error.message);
    return data;
};


exports.getUserById = async (id) => {
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', id)
        .single();
    if (error) throw new Error(error.message);
    return data;
};

exports.updateUser = async (id, userData) => {
    const { data, error } = await supabase
        .from('users')
        .update(userData)
        .eq('id', id);
    if (error) throw new Error(error.message);
    return data;
};

exports.deleteUser = async (id) => {
    const { data, error } = await supabase
        .from('users')
        .delete()
        .eq('id', id);
    if (error) throw new Error(error.message);
    return data;
};
