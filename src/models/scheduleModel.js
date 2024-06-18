const supabase = require('../supabaseClient');

const createSchedule = async (schedule) => {
    const { data, error } = await supabase
        .from('inventory_management_schedules')
        .insert([schedule]);
    if (error) throw error;
    return data;
};

const getSchedulesByUserId = async (userId) => {
    const { data, error } = await supabase
        .from('inventory_management_schedules')
        .select('*')
        .eq('user_id', userId);
    if (error) throw error;
    return data;
};

const updateSchedule = async (id, updates) => {
    const { data, error } = await supabase
        .from('inventory_management_schedules')
        .update(updates)
        .eq('id', id);
    if (error) throw error;
    return data;
};

const deleteSchedule = async (id) => {
    const { data, error } = await supabase
        .from('inventory_management_schedules')
        .delete()
        .eq('id', id);
    if (error) throw error;
    return data;
};

module.exports = { createSchedule, getSchedulesByUserId, updateSchedule, deleteSchedule };
