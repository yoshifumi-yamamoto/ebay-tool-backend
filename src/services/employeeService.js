const supabase = require('../supabaseClient');

const normalizeText = (value) => {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
};

const normalizeStatus = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const lowered = normalized.toLowerCase();
  if (lowered === 'active' || lowered === 'inactive') {
    return lowered;
  }
  return null;
};

const normalizeNumber = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeEmployeePayload = (payload = {}) => ({
  display_name: normalizeText(payload.display_name || payload.displayName),
  payroll_name: normalizeText(payload.payroll_name || payload.payrollName),
  status: normalizeStatus(payload.status) || 'active',
  incentive_rate: normalizeNumber(payload.incentive_rate ?? payload.incentiveRate),
  paypay_bank_code: normalizeText(payload.paypay_bank_code || payload.paypayBankCode),
  paypay_bank_name: normalizeText(payload.paypay_bank_name || payload.paypayBankName),
  paypay_branch_code: normalizeText(payload.paypay_branch_code || payload.paypayBranchCode),
  paypay_branch_name: normalizeText(payload.paypay_branch_name || payload.paypayBranchName),
  paypay_account_type: normalizeText(payload.paypay_account_type || payload.paypayAccountType),
  paypay_account_number: normalizeText(payload.paypay_account_number || payload.paypayAccountNumber),
  paypay_account_name: normalizeText(payload.paypay_account_name || payload.paypayAccountName),
  paypay_account_name_kana: normalizeText(payload.paypay_account_name_kana || payload.paypayAccountNameKana),
});

async function listEmployees(userId) {
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .eq('user_id', userId)
    .order('display_name', { ascending: true });
  if (error) {
    throw new Error(`Failed to fetch employees: ${error.message}`);
  }
  return data || [];
}

async function createEmployee(userId, payload = {}) {
  const record = normalizeEmployeePayload(payload);
  record.user_id = userId;
  if (!record.display_name) {
    throw new Error('display_name is required');
  }
  if (!record.payroll_name) {
    throw new Error('payroll_name is required');
  }
  if (record.incentive_rate === null || record.incentive_rate === undefined) {
    record.incentive_rate = 0.1;
  }
  const { data, error } = await supabase
    .from('employees')
    .insert(record)
    .select()
    .single();
  if (error) {
    throw new Error(`Failed to create employee: ${error.message}`);
  }
  return data;
}

async function updateEmployee(userId, id, payload = {}) {
  const updates = normalizeEmployeePayload(payload);
  updates.updated_at = new Date().toISOString();
  if (updates.incentive_rate === null || updates.incentive_rate === undefined) {
    delete updates.incentive_rate;
  }
  const { data, error } = await supabase
    .from('employees')
    .update(updates)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();
  if (error) {
    throw new Error(`Failed to update employee: ${error.message}`);
  }
  return data;
}

async function deleteEmployee(userId, id) {
  const { error } = await supabase
    .from('employees')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  if (error) {
    throw new Error(`Failed to delete employee: ${error.message}`);
  }
}

module.exports = {
  listEmployees,
  createEmployee,
  updateEmployee,
  deleteEmployee,
};
