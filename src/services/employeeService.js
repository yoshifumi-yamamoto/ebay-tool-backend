const supabase = require('../supabaseClient');
const { Parser } = require('json2csv');
const csv = require('csv-parser');
const { Readable } = require('stream');

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
  status: normalizeStatus(payload.status) || null,
  incentive_rate: normalizeNumber(payload.incentive_rate ?? payload.incentiveRate),
  bank_code: normalizeText(payload.bank_code || payload.bankCode),
  bank_name: normalizeText(payload.bank_name || payload.bankName),
  branch_code: normalizeText(payload.branch_code || payload.branchCode),
  branch_name: normalizeText(payload.branch_name || payload.branchName),
  account_type: normalizeText(payload.account_type || payload.accountType),
  account_number: normalizeText(payload.account_number || payload.accountNumber),
  account_name: normalizeText(payload.account_name || payload.accountName),
  account_name_kana: normalizeText(payload.account_name_kana || payload.accountNameKana),
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
  if (!record.status) {
    record.status = 'active';
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
  if (!updates.status) {
    delete updates.status;
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

const parseCsvBuffer = (fileBuffer) =>
  new Promise((resolve, reject) => {
    const rows = [];
    const stream = Readable.from(fileBuffer);
    stream
      .pipe(
        csv({
          mapHeaders: ({ header }) => header.trim().replace(/^"|"$/g, '').replace(/^\uFEFF/, ''),
        })
      )
      .on('data', (data) => rows.push(data))
      .on('end', () => resolve(rows))
      .on('error', (error) => reject(error));
  });

const buildEmployeeUpdateFromRow = (row = {}) => {
  const payload = normalizeEmployeePayload(row);
  const updates = {};
  Object.entries(payload).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') {
      updates[key] = value;
    }
  });
  if (!updates.status) {
    delete updates.status;
  }
  return updates;
};

async function downloadEmployeesCsv(userId) {
  const employees = await listEmployees(userId);
  const csvFields = [
    'display_name',
    'payroll_name',
    'status',
    'incentive_rate',
    'bank_code',
    'bank_name',
    'branch_code',
    'branch_name',
    'account_type',
    'account_number',
    'account_name',
    'account_name_kana',
  ];
  const parser = new Parser({ fields: csvFields });
  return parser.parse(employees);
}

async function upsertEmployeesFromCsv(userId, fileBuffer) {
  const rows = await parseCsvBuffer(fileBuffer);
  const { data: existing, error } = await supabase
    .from('employees')
    .select('*')
    .eq('user_id', userId);
  if (error) {
    throw new Error(`Failed to fetch employees: ${error.message}`);
  }

  const existingByName = new Map(
    (existing || []).map((employee) => [employee.display_name, employee])
  );
  const summary = { created: 0, updated: 0, skipped: 0, errors: [] };

  for (const row of rows) {
    const displayName = normalizeText(row.display_name || row.displayName);
    if (!displayName) {
      summary.skipped += 1;
      continue;
    }

    const existingEmployee = existingByName.get(displayName);
    const updates = buildEmployeeUpdateFromRow(row);

    if (existingEmployee) {
      if (Object.keys(updates).length === 0) {
        summary.skipped += 1;
        continue;
      }
      updates.updated_at = new Date().toISOString();
      const { error: updateError } = await supabase
        .from('employees')
        .update(updates)
        .eq('id', existingEmployee.id)
        .eq('user_id', userId);
      if (updateError) {
        summary.errors.push({ display_name: displayName, error: updateError.message });
      } else {
        summary.updated += 1;
      }
      continue;
    }

    const payload = normalizeEmployeePayload(row);
    payload.display_name = displayName;
    payload.user_id = userId;
    if (!payload.payroll_name) {
      summary.errors.push({ display_name: displayName, error: 'payroll_name is required' });
      continue;
    }
    if (payload.incentive_rate === null || payload.incentive_rate === undefined) {
      payload.incentive_rate = 0.1;
    }
    if (!payload.status) {
      payload.status = 'active';
    }
    const { error: insertError } = await supabase
      .from('employees')
      .insert(payload);
    if (insertError) {
      summary.errors.push({ display_name: displayName, error: insertError.message });
    } else {
      summary.created += 1;
      existingByName.set(displayName, payload);
    }
  }

  return summary;
}

module.exports = {
  listEmployees,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  downloadEmployeesCsv,
  upsertEmployeesFromCsv,
};
