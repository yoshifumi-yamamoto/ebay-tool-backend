const supabase = require('../supabaseClient');

const normalizeText = (value) => {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  return text ? text : null;
};

const normalizeBoolean = (value) => Boolean(value);

const buildInsertPayload = (payload = {}) => ({
  error_code: normalizeText(payload.error_code) || 'UNKNOWN',
  category: normalizeText(payload.category) || 'UNKNOWN',
  severity: normalizeText(payload.severity) || 'ERROR',
  provider: normalizeText(payload.provider) || 'unknown',
  message: normalizeText(payload.message) || 'Unknown error',
  retryable: normalizeBoolean(payload.retryable),
  user_id: payload.user_id ?? null,
  account_id: payload.account_id ?? null,
  order_id: payload.order_id ?? null,
  job_id: payload.job_id ?? null,
  request_id: normalizeText(payload.request_id),
  payload_summary: payload.payload_summary ?? null,
  details: payload.details ?? null,
});

const logSystemError = async (payload = {}) => {
  const insertPayload = buildInsertPayload(payload);
  try {
    const { error } = await supabase.from('system_errors').insert([insertPayload]);
    if (error) {
      console.error('Failed to save system error:', error.message);
    }
  } catch (err) {
    console.error('Unexpected error while saving system error:', err);
  }
};

const listSystemErrors = async (filters = {}) => {
  const {
    limit = 50,
    user_id,
    account_id,
    provider,
    category,
    severity,
    error_code,
  } = filters;

  let query = supabase
    .from('system_errors')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (user_id) query = query.eq('user_id', user_id);
  if (account_id) query = query.eq('account_id', account_id);
  if (provider) query = query.eq('provider', provider);
  if (category) query = query.eq('category', category);
  if (severity) query = query.eq('severity', severity);
  if (error_code) query = query.eq('error_code', error_code);

  const { data, error } = await query;
  if (error) {
    console.error('Failed to fetch system errors:', error.message);
    throw error;
  }
  return data || [];
};

module.exports = {
  logSystemError,
  listSystemErrors,
};
