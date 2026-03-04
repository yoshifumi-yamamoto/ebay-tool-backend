const supabase = require('../supabaseClient');

const INCLUDED_STOCK_STATUSES = ['in_stock', 'returned', 'cancel_stock', 'domestic_sale'];

const toIntOrNull = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
};

const ensureDraft = (session) => {
  if (!session) throw new Error('Inventory count session not found');
  if (session.status !== 'draft') throw new Error('Only draft session can be updated');
};

const fetchTheoreticalRows = async ({ userId, locationCode }) => {
  const { data, error } = await supabase
    .from('inventory_units')
    .select('sku, cost_yen')
    .eq('user_id', userId)
    .eq('location_code', locationCode)
    .in('status_code', INCLUDED_STOCK_STATUSES);
  if (error) throw new Error(`Failed to fetch inventory units: ${error.message}`);

  const grouped = (data || []).reduce((acc, row) => {
    if (!row?.sku) return acc;
    if (!acc[row.sku]) {
      acc[row.sku] = { sku: row.sku, qty: 0, costSum: 0, costCount: 0 };
    }
    acc[row.sku].qty += 1;
    const cost = toIntOrNull(row.cost_yen);
    if (cost !== null) {
      acc[row.sku].costSum += cost;
      acc[row.sku].costCount += 1;
    }
    return acc;
  }, {});

  return Object.values(grouped).map((row) => ({
    sku: row.sku,
    theoretical_qty: row.qty,
    unit_cost_yen: row.costCount > 0 ? Math.round(row.costSum / row.costCount) : null,
  }));
};

const rebuildLinesInternal = async ({ userId, inventoryCountId }) => {
  const { data: session, error: sessionError } = await supabase
    .from('inventory_counts')
    .select('id, user_id, location_code, status')
    .eq('id', inventoryCountId)
    .eq('user_id', userId)
    .single();
  if (sessionError) throw new Error(`Failed to fetch session: ${sessionError.message}`);
  ensureDraft(session);

  const { data: existingLines, error: existingError } = await supabase
    .from('inventory_count_lines')
    .select('sku, counted_qty, note')
    .eq('inventory_count_id', inventoryCountId);
  if (existingError) throw new Error(`Failed to fetch existing lines: ${existingError.message}`);

  const existingBySku = (existingLines || []).reduce((acc, line) => {
    if (line?.sku) acc[line.sku] = line;
    return acc;
  }, {});

  const theoreticalRows = await fetchTheoreticalRows({
    userId,
    locationCode: session.location_code,
  });
  const theoreticalBySku = theoreticalRows.reduce((acc, row) => {
    acc[row.sku] = row;
    return acc;
  }, {});

  const rebuilt = [...theoreticalRows.map((row) => ({
    inventory_count_id: inventoryCountId,
    sku: row.sku,
    theoretical_qty: row.theoretical_qty,
    unit_cost_yen: row.unit_cost_yen,
    counted_qty: existingBySku[row.sku]?.counted_qty ?? null,
    note: existingBySku[row.sku]?.note ?? null,
    updated_at: new Date().toISOString(),
  }))];

  // Keep manually counted SKUs even if current theoretical source has 0.
  Object.values(existingBySku).forEach((line) => {
    if (theoreticalBySku[line.sku]) return;
    if (line.counted_qty === null && !line.note) return;
    rebuilt.push({
      inventory_count_id: inventoryCountId,
      sku: line.sku,
      theoretical_qty: 0,
      unit_cost_yen: null,
      counted_qty: line.counted_qty ?? null,
      note: line.note ?? null,
      updated_at: new Date().toISOString(),
    });
  });

  const { error: deleteError } = await supabase
    .from('inventory_count_lines')
    .delete()
    .eq('inventory_count_id', inventoryCountId);
  if (deleteError) throw new Error(`Failed to delete lines: ${deleteError.message}`);

  if (rebuilt.length > 0) {
    const { error: insertError } = await supabase
      .from('inventory_count_lines')
      .insert(rebuilt);
    if (insertError) throw new Error(`Failed to insert rebuilt lines: ${insertError.message}`);
  }

  const { error: touchError } = await supabase
    .from('inventory_counts')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', inventoryCountId);
  if (touchError) throw new Error(`Failed to update session timestamp: ${touchError.message}`);
};

const listInventoryCounts = async ({ userId, status, location_code, from_date, to_date, page = 0, limit = 20 }) => {
  const safeLimit = Number.isFinite(Number(limit)) ? Math.min(Number(limit), 100) : 20;
  const safePage = Number.isFinite(Number(page)) ? Math.max(Number(page), 0) : 0;
  const offset = safePage * safeLimit;

  let query = supabase
    .from('inventory_counts')
    .select('id,title,counted_at,location_code,status,created_at,updated_at', { count: 'exact' })
    .eq('user_id', userId)
    .order('counted_at', { ascending: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + safeLimit - 1);

  if (status) query = query.eq('status', status);
  if (location_code) query = query.eq('location_code', location_code);
  if (from_date) query = query.gte('counted_at', from_date);
  if (to_date) query = query.lte('counted_at', to_date);

  const { data, error, count } = await query;
  if (error) throw new Error(`Failed to fetch sessions: ${error.message}`);

  const ids = (data || []).map((row) => row.id);
  let summaryById = {};
  if (ids.length > 0) {
    const { data: lines, error: linesError } = await supabase
      .from('inventory_count_lines')
      .select('inventory_count_id,diff_value_yen')
      .in('inventory_count_id', ids);
    if (!linesError && Array.isArray(lines)) {
      summaryById = lines.reduce((acc, row) => {
        const key = row.inventory_count_id;
        if (!acc[key]) acc[key] = { diff_value_total_yen: 0 };
        const value = toIntOrNull(row.diff_value_yen);
        if (value !== null) acc[key].diff_value_total_yen += value;
        return acc;
      }, {});
    }
  }

  return {
    data: (data || []).map((row) => ({
      ...row,
      diff_value_total_yen: summaryById[row.id]?.diff_value_total_yen || 0,
    })),
    total: count || 0,
    page: safePage,
    limit: safeLimit,
  };
};

const createInventoryCount = async ({ userId, title, counted_at, location_code, created_by }) => {
  const payload = {
    user_id: userId,
    title: title || `${counted_at} 棚卸し`,
    counted_at,
    location_code,
    status: 'draft',
    created_by: created_by || null,
  };
  const { data, error } = await supabase
    .from('inventory_counts')
    .insert([payload])
    .select('*')
    .single();
  if (error) throw new Error(`Failed to create inventory count: ${error.message}`);

  await rebuildLinesInternal({ userId, inventoryCountId: data.id });
  return data;
};

const rebuildInventoryCountLines = async ({ userId, inventoryCountId }) => {
  await rebuildLinesInternal({ userId, inventoryCountId });
};

const updateInventoryCountLine = async ({ userId, lineId, counted_qty, note }) => {
  const { data: line, error: lineError } = await supabase
    .from('inventory_count_lines')
    .select('id, inventory_count_id')
    .eq('id', lineId)
    .single();
  if (lineError) throw new Error(`Failed to fetch line: ${lineError.message}`);

  const { data: session, error: sessionError } = await supabase
    .from('inventory_counts')
    .select('id,user_id,status')
    .eq('id', line.inventory_count_id)
    .eq('user_id', userId)
    .single();
  if (sessionError) throw new Error(`Failed to fetch session: ${sessionError.message}`);
  ensureDraft(session);

  const patch = { updated_at: new Date().toISOString() };
  if (counted_qty !== undefined) patch.counted_qty = toIntOrNull(counted_qty);
  if (note !== undefined) patch.note = note;

  const { data, error } = await supabase
    .from('inventory_count_lines')
    .update(patch)
    .eq('id', lineId)
    .select('*')
    .single();
  if (error) throw new Error(`Failed to update line: ${error.message}`);
  return data;
};

const transitionInventoryCountStatus = async ({ userId, inventoryCountId, nextStatus }) => {
  const { data: session, error: sessionError } = await supabase
    .from('inventory_counts')
    .select('id,user_id,status')
    .eq('id', inventoryCountId)
    .eq('user_id', userId)
    .single();
  if (sessionError) throw new Error(`Failed to fetch session: ${sessionError.message}`);

  if (nextStatus === 'frozen' && session.status !== 'draft') {
    throw new Error('Only draft session can be frozen');
  }
  if (nextStatus === 'closed' && !['draft', 'frozen'].includes(session.status)) {
    throw new Error('Only draft/frozen session can be closed');
  }

  const { data, error } = await supabase
    .from('inventory_counts')
    .update({ status: nextStatus, updated_at: new Date().toISOString() })
    .eq('id', inventoryCountId)
    .select('*')
    .single();
  if (error) throw new Error(`Failed to update session status: ${error.message}`);
  return data;
};

const getInventoryCountById = async ({
  userId,
  inventoryCountId,
  skuLike,
  diffOnly = false,
  page = 0,
  limit = 200,
}) => {
  const { data: session, error: sessionError } = await supabase
    .from('inventory_counts')
    .select('*')
    .eq('id', inventoryCountId)
    .eq('user_id', userId)
    .single();
  if (sessionError) throw new Error(`Failed to fetch session: ${sessionError.message}`);

  const safeLimit = Number.isFinite(Number(limit)) ? Math.min(Number(limit), 500) : 200;
  const safePage = Number.isFinite(Number(page)) ? Math.max(Number(page), 0) : 0;
  const offset = safePage * safeLimit;

  let query = supabase
    .from('inventory_count_lines')
    .select('*', { count: 'exact' })
    .eq('inventory_count_id', inventoryCountId)
    .order('sku', { ascending: true })
    .range(offset, offset + safeLimit - 1);

  if (skuLike) query = query.ilike('sku', `%${skuLike}%`);
  if (diffOnly) query = query.not('diff_qty', 'is', null).neq('diff_qty', 0);

  const { data: lines, error: linesError, count } = await query;
  if (linesError) throw new Error(`Failed to fetch lines: ${linesError.message}`);

  return {
    session,
    lines: lines || [],
    total: count || 0,
    page: safePage,
    limit: safeLimit,
  };
};

const getInventoryCountSummary = async ({ userId, inventoryCountId }) => {
  const { data: session, error: sessionError } = await supabase
    .from('inventory_counts')
    .select('id')
    .eq('id', inventoryCountId)
    .eq('user_id', userId)
    .single();
  if (sessionError || !session) throw new Error('Inventory count session not found');

  const { data: lines, error: linesError } = await supabase
    .from('inventory_count_lines')
    .select('sku,theoretical_qty,counted_qty,diff_qty,unit_cost_yen,diff_value_yen')
    .eq('inventory_count_id', inventoryCountId);
  if (linesError) throw new Error(`Failed to fetch lines: ${linesError.message}`);

  const summary = (lines || []).reduce(
    (acc, row) => {
      acc.theoretical_qty_total += toIntOrNull(row.theoretical_qty) || 0;
      acc.counted_qty_total += toIntOrNull(row.counted_qty) || 0;
      acc.diff_qty_total += toIntOrNull(row.diff_qty) || 0;
      const diffValue = toIntOrNull(row.diff_value_yen);
      if (diffValue !== null) acc.diff_value_yen_total += diffValue;
      return acc;
    },
    {
      theoretical_qty_total: 0,
      counted_qty_total: 0,
      diff_qty_total: 0,
      diff_value_yen_total: 0,
    }
  );

  const topDiffs = [...(lines || [])]
    .filter((row) => (toIntOrNull(row.diff_qty) || 0) !== 0)
    .sort((a, b) => Math.abs(toIntOrNull(b.diff_value_yen) || 0) - Math.abs(toIntOrNull(a.diff_value_yen) || 0))
    .slice(0, 20);

  return { ...summary, top_diffs: topDiffs };
};

module.exports = {
  INCLUDED_STOCK_STATUSES,
  listInventoryCounts,
  createInventoryCount,
  rebuildInventoryCountLines,
  updateInventoryCountLine,
  transitionInventoryCountStatus,
  getInventoryCountById,
  getInventoryCountSummary,
};
