const supabase = require('../supabaseClient');

const TABLE_NAME = 'fixed_costs';

const toNumber = (value) => {
  if (value === undefined || value === null || value === '') {
    return 0;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const normalized = value.replace(/[^0-9.-]/g, '');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const listFixedCosts = async ({ user_id }) => {
  if (!user_id) {
    throw new Error('user_id is required');
  }
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('*')
    .eq('user_id', user_id)
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }
  return data || [];
};

const createFixedCost = async (payload) => {
  const insertPayload = {
    user_id: payload.user_id,
    name: payload.name,
    amount_jpy: toNumber(payload.amount_jpy),
    category: payload.category || null,
    billing_cycle: payload.billing_cycle || 'monthly',
    start_date: payload.start_date || null,
    end_date: payload.end_date || null,
    note: payload.note || null,
    active: payload.active !== undefined ? Boolean(payload.active) : true,
  };

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .insert(insertPayload)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return data;
};

const updateFixedCost = async (id, payload) => {
  if (!id) {
    throw new Error('id is required');
  }

  const updatePayload = {
    name: payload.name,
    amount_jpy: payload.amount_jpy !== undefined ? toNumber(payload.amount_jpy) : undefined,
    category: payload.category,
    billing_cycle: payload.billing_cycle,
    start_date: payload.start_date,
    end_date: payload.end_date,
    note: payload.note,
    active: payload.active !== undefined ? Boolean(payload.active) : undefined,
    updated_at: new Date().toISOString(),
  };

  Object.keys(updatePayload).forEach((key) => {
    if (updatePayload[key] === undefined) {
      delete updatePayload[key];
    }
  });

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .update(updatePayload)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return data;
};

const deleteFixedCost = async (id) => {
  if (!id) {
    throw new Error('id is required');
  }
  const { error } = await supabase
    .from(TABLE_NAME)
    .delete()
    .eq('id', id);

  if (error) {
    throw error;
  }

  return true;
};

const getFixedCostSummary = async ({ user_id }) => {
  const costs = await listFixedCosts({ user_id });
  const activeCosts = costs.filter((cost) => cost.active !== false);
  const totalMonthlyJpy = activeCosts.reduce(
    (acc, cost) => acc + toNumber(cost.amount_jpy),
    0
  );

  const byCategory = activeCosts.reduce((acc, cost) => {
    const key = cost.category || '未分類';
    acc[key] = (acc[key] || 0) + toNumber(cost.amount_jpy);
    return acc;
  }, {});

  return {
    total_monthly_jpy: totalMonthlyJpy,
    by_category: byCategory,
    count: activeCosts.length,
  };
};

module.exports = {
  listFixedCosts,
  createFixedCost,
  updateFixedCost,
  deleteFixedCost,
  getFixedCostSummary,
};
