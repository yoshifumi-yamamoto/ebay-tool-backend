const supabase = require('../supabaseClient');

const getEffectivePolicyStatus = (row) => {
  if (row.shipping_policy_status) return row.shipping_policy_status;
  if (row.is_shipping_allowed === true) return 'allow';
  if (row.is_shipping_allowed === false) return 'exclude';
  return 'review';
};

const buildSummary = (rows) => rows.reduce(
  (acc, row) => {
    const status = getEffectivePolicyStatus(row);
    acc.total += 1;
    acc[status] += 1;
    if (row.manual_override) acc.manual_override += 1;
    if (row.review_status === 'watchlist') acc.watchlist += 1;
    return acc;
  },
  { total: 0, allow: 0, exclude: 0, review: 0, manual_override: 0, watchlist: 0 }
);

const listShippingCountryGuides = async (filters = {}) => {
  let query = supabase
    .from('shipping_country_classifications')
    .select(`
      country_code,
      country_name_ja,
      country_name_en,
      fedex_zone_export,
      fedex_zone_import,
      fedex_zone_note,
      dhl_zone,
      ebay_shipping_region,
      japan_post_parcel_air,
      japan_post_ems,
      is_shipping_allowed,
      exclusion_reason,
      shipping_policy_status,
      shipping_policy_note,
      restriction_category,
      review_status,
      review_priority,
      source_checked_on,
      reviewed_on,
      manual_override,
      manual_override_reason,
      updated_by,
      source_summary,
      last_confirmed_on,
      updated_at
    `)
    .order('country_name_ja', { ascending: true });

  if (filters.q) {
    const like = `%${filters.q}%`;
    query = query.or(
      `country_name_ja.ilike.${like},country_name_en.ilike.${like},country_code.ilike.${like},exclusion_reason.ilike.${like},shipping_policy_note.ilike.${like}`
    );
  }
  if (filters.review_status && filters.review_status !== 'all') {
    query = query.eq('review_status', filters.review_status);
  }
  if (filters.manual_override === 'true') {
    query = query.eq('manual_override', true);
  }
  if (filters.manual_override === 'false') {
    query = query.eq('manual_override', false);
  }
  if (filters.jp_parcel_air && filters.jp_parcel_air !== 'all') {
    query = query.eq('japan_post_parcel_air', filters.jp_parcel_air);
  }
  if (filters.jp_ems && filters.jp_ems !== 'all') {
    query = query.eq('japan_post_ems', filters.jp_ems);
  }
  if (filters.ebay_shipping_region && filters.ebay_shipping_region !== 'all') {
    query = query.eq('ebay_shipping_region', filters.ebay_shipping_region);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to fetch shipping country guides: ${error.message}`);
  }

  let rows = (data || []).map((row) => ({
    ...row,
    effective_shipping_policy_status: getEffectivePolicyStatus(row),
  }));

  if (filters.policy_status && filters.policy_status !== 'all') {
    rows = rows.filter((row) => row.effective_shipping_policy_status === filters.policy_status);
  }

  return {
    rows,
    summary: buildSummary(rows),
  };
};

const updateShippingCountryGuide = async (countryNameJa, payload = {}) => {
  const allowedFields = [
    'shipping_policy_status',
    'shipping_policy_note',
    'restriction_category',
    'review_status',
    'review_priority',
    'source_checked_on',
    'reviewed_on',
    'manual_override',
    'manual_override_reason',
    'updated_by',
    'exclusion_reason',
    'is_shipping_allowed',
  ];

  const updatePayload = Object.fromEntries(
    Object.entries(payload).filter(([key]) => allowedFields.includes(key))
  );

  const { data, error } = await supabase
    .from('shipping_country_classifications')
    .update(updatePayload)
    .eq('country_name_ja', countryNameJa)
    .select(`
      country_code,
      country_name_ja,
      country_name_en,
      shipping_policy_status,
      review_status,
      manual_override,
      exclusion_reason,
      updated_at
    `)
    .single();

  if (error) {
    throw new Error(`Failed to update shipping country guide: ${error.message}`);
  }

  return {
    ...data,
    effective_shipping_policy_status: getEffectivePolicyStatus(data),
  };
};

module.exports = {
  listShippingCountryGuides,
  updateShippingCountryGuide,
};
