const supabase = require('../supabaseClient');

const QUADRANT_TABLE = 'priority_quadrants';
const MEMO_TABLE = 'daily_memos';

const toNumber = (value) => {
  if (value === undefined || value === null || value === '') return 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const listQuadrants = async ({ user_id }) => {
  if (!user_id) throw new Error('user_id is required');
  const { data, error } = await supabase
    .from(QUADRANT_TABLE)
    .select('*')
    .eq('user_id', user_id)
    .order('quadrant', { ascending: true })
    .order('order_index', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
};

const createQuadrant = async (payload) => {
  const insertPayload = {
    user_id: payload.user_id,
    title: payload.title,
    detail: payload.detail || null,
    quadrant: payload.quadrant,
    due_date: payload.due_date || null,
    is_done: payload.is_done ? true : false,
    order_index: toNumber(payload.order_index),
  };
  const { data, error } = await supabase
    .from(QUADRANT_TABLE)
    .insert(insertPayload)
    .select('*')
    .single();
  if (error) throw error;
  return data;
};

const updateQuadrant = async (id, payload) => {
  if (!id) throw new Error('id is required');
  const updatePayload = {
    title: payload.title,
    detail: payload.detail,
    quadrant: payload.quadrant,
    due_date: payload.due_date,
    is_done: payload.is_done !== undefined ? Boolean(payload.is_done) : undefined,
    order_index: payload.order_index !== undefined ? toNumber(payload.order_index) : undefined,
    updated_at: new Date().toISOString(),
  };
  Object.keys(updatePayload).forEach((key) => {
    if (updatePayload[key] === undefined) delete updatePayload[key];
  });
  const { data, error } = await supabase
    .from(QUADRANT_TABLE)
    .update(updatePayload)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
};

const deleteQuadrant = async (id) => {
  if (!id) throw new Error('id is required');
  const { error } = await supabase.from(QUADRANT_TABLE).delete().eq('id', id);
  if (error) throw error;
  return true;
};

const listMemos = async ({ user_id }) => {
  if (!user_id) throw new Error('user_id is required');
  const { data, error } = await supabase
    .from(MEMO_TABLE)
    .select('*')
    .eq('user_id', user_id)
    .order('memo_date', { ascending: false });
  if (error) throw error;
  return data || [];
};

const upsertMemo = async (payload) => {
  const insertPayload = {
    user_id: payload.user_id,
    memo_date: payload.memo_date,
    content: payload.content || '',
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from(MEMO_TABLE)
    .upsert(insertPayload, { onConflict: 'user_id,memo_date' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
};

const deleteMemo = async (id) => {
  if (!id) throw new Error('id is required');
  const { error } = await supabase.from(MEMO_TABLE).delete().eq('id', id);
  if (error) throw error;
  return true;
};

module.exports = {
  listQuadrants,
  createQuadrant,
  updateQuadrant,
  deleteQuadrant,
  listMemos,
  upsertMemo,
  deleteMemo,
};
