const supabase = require('../supabaseClient');

const toNumberOrNull = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

exports.fetchPackingVerification = async (filters = {}) => {
  const {
    user_id,
    start_date,
    end_date,
    limit = 200,
    offset = 0,
    ebay_user_id,
    shipping_carrier,
  } = filters;

  if (!user_id) {
    throw new Error('user_id is required');
  }

  const safeLimit = Number.isFinite(Number(limit)) ? Math.min(Number(limit), 500) : 200;
  const safeOffset = Number.isFinite(Number(offset)) ? Math.max(Number(offset), 0) : 0;

  let query = supabase
    .from('orders')
    .select(`
      id,
      order_no,
      order_date,
      ebay_user_id,
      shipping_status,
      shipping_tracking_number,
      shipping_carrier,
      shipping_cost,
      final_shipping_cost,
      shipco_parcel_weight,
      shipco_parcel_weight_unit,
      shipco_parcel_length,
      shipco_parcel_width,
      shipco_parcel_height,
      shipco_parcel_dimension_unit
    `, { count: 'exact' })
    .eq('user_id', user_id)
    .eq('shipping_status', 'SHIPPED')
    .order('order_date', { ascending: false })
    .range(safeOffset, safeOffset + safeLimit - 1);

  if (start_date) query = query.gte('order_date', start_date);
  if (end_date) query = query.lte('order_date', end_date);
  if (ebay_user_id) query = query.eq('ebay_user_id', ebay_user_id);
  if (shipping_carrier) query = query.eq('shipping_carrier', shipping_carrier);

  const { data, error, count } = await query;
  if (error) {
    console.error('Failed to fetch packing verification data:', error.message);
    throw error;
  }

  return {
    data: (data || []).map((row) => ({
      ...row,
      shipping_cost: toNumberOrNull(row.shipping_cost),
      final_shipping_cost: toNumberOrNull(row.final_shipping_cost),
      shipco_parcel_weight: toNumberOrNull(row.shipco_parcel_weight),
      shipco_parcel_length: toNumberOrNull(row.shipco_parcel_length),
      shipco_parcel_width: toNumberOrNull(row.shipco_parcel_width),
      shipco_parcel_height: toNumberOrNull(row.shipco_parcel_height),
    })),
    total: count || 0,
  };
};
