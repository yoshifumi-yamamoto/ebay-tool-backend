const supabase = require('../supabaseClient');

const normalizeNumber = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeText = (value) => {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
};

async function listHtsCodes(userId) {
  const { data, error } = await supabase
    .from('hts_codes')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) {
    throw new Error(`Failed to fetch HTS codes: ${error.message}`);
  }
  return data || [];
}

async function createHtsCode(userId, payload = {}) {
  const record = {
    user_id: userId,
    hts_code: normalizeText(payload.hts_code),
    category: normalizeText(payload.category),
    duty_rate_percent: normalizeNumber(payload.duty_rate_percent),
    duty_amount_jpy: normalizeNumber(payload.duty_amount_jpy),
    note: normalizeText(payload.note),
  };
  if (!record.hts_code) {
    throw new Error('hts_code is required');
  }
  const { data, error } = await supabase
    .from('hts_codes')
    .insert(record)
    .select()
    .single();
  if (error) {
    throw new Error(`Failed to create HTS code: ${error.message}`);
  }
  return data;
}

async function updateHtsCode(userId, id, payload = {}) {
  const updates = {
    hts_code: normalizeText(payload.hts_code),
    category: normalizeText(payload.category),
    duty_rate_percent: normalizeNumber(payload.duty_rate_percent),
    duty_amount_jpy: normalizeNumber(payload.duty_amount_jpy),
    note: normalizeText(payload.note),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('hts_codes')
    .update(updates)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();
  if (error) {
    throw new Error(`Failed to update HTS code: ${error.message}`);
  }
  return data;
}

async function deleteHtsCode(userId, id) {
  const { error } = await supabase
    .from('hts_codes')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  if (error) {
    throw new Error(`Failed to delete HTS code: ${error.message}`);
  }
}

module.exports = {
  listHtsCodes,
  createHtsCode,
  updateHtsCode,
  deleteHtsCode,
};
