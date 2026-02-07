const supabase = require('../supabaseClient');

const normalizeText = (value) => {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
};

async function listNameMaps(userId) {
  const { data, error } = await supabase
    .from('name_map')
    .select('*, employee:employee_id (id, display_name, payroll_name, status)')
    .eq('user_id', userId)
    .order('raw_name', { ascending: true });
  if (error) {
    throw new Error(`Failed to fetch name map: ${error.message}`);
  }
  return data || [];
}

async function createNameMap(userId, payload = {}) {
  const rawName = normalizeText(payload.raw_name || payload.rawName);
  const employeeId = normalizeText(payload.employee_id || payload.employeeId);
  if (!rawName) {
    throw new Error('raw_name is required');
  }
  if (!employeeId) {
    throw new Error('employee_id is required');
  }
  const { data, error } = await supabase
    .from('name_map')
    .insert({
      user_id: userId,
      raw_name: rawName,
      employee_id: employeeId,
    })
    .select('*, employee:employee_id (id, display_name, payroll_name, status)')
    .single();
  if (error) {
    throw new Error(`Failed to create name map: ${error.message}`);
  }
  return data;
}

async function updateNameMap(userId, id, payload = {}) {
  const updates = {
    raw_name: normalizeText(payload.raw_name || payload.rawName),
    employee_id: normalizeText(payload.employee_id || payload.employeeId),
    updated_at: new Date().toISOString(),
  };
  if (!updates.raw_name) {
    delete updates.raw_name;
  }
  if (!updates.employee_id) {
    delete updates.employee_id;
  }
  const { data, error } = await supabase
    .from('name_map')
    .update(updates)
    .eq('id', id)
    .eq('user_id', userId)
    .select('*, employee:employee_id (id, display_name, payroll_name, status)')
    .single();
  if (error) {
    throw new Error(`Failed to update name map: ${error.message}`);
  }
  return data;
}

async function deleteNameMap(userId, id) {
  const { error } = await supabase
    .from('name_map')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  if (error) {
    throw new Error(`Failed to delete name map: ${error.message}`);
  }
}

module.exports = {
  listNameMaps,
  createNameMap,
  updateNameMap,
  deleteNameMap,
};
