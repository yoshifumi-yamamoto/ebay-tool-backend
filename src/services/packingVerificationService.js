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
    order_no,
    tracking_number,
    final_shipping_status = 'all',
  } = filters;

  if (!user_id) {
    throw new Error('user_id is required');
  }

  const safeLimit = Number.isFinite(Number(limit)) ? Math.min(Number(limit), 500) : 200;
  const safeOffset = Number.isFinite(Number(offset)) ? Math.max(Number(offset), 0) : 0;
  const normalizedFinalShippingStatus = String(final_shipping_status || 'all').toLowerCase();
  const needsFinalShippingFilter =
    normalizedFinalShippingStatus === 'confirmed' || normalizedFinalShippingStatus === 'unconfirmed';

  let carrierMetaQuery = supabase
    .from('orders')
    .select('shipping_carrier')
    .eq('user_id', user_id)
    .eq('shipping_status', 'SHIPPED');

  if (start_date) carrierMetaQuery = carrierMetaQuery.gte('order_date', start_date);
  if (end_date) carrierMetaQuery = carrierMetaQuery.lte('order_date', end_date);
  if (ebay_user_id) carrierMetaQuery = carrierMetaQuery.eq('ebay_user_id', ebay_user_id);
  if (order_no) carrierMetaQuery = carrierMetaQuery.ilike('order_no', `%${order_no}%`);
  if (tracking_number) carrierMetaQuery = carrierMetaQuery.ilike('shipping_tracking_number', `%${tracking_number}%`);
  if (normalizedFinalShippingStatus === 'confirmed') {
    carrierMetaQuery = carrierMetaQuery.not('final_shipping_cost', 'is', null);
  } else if (normalizedFinalShippingStatus === 'unconfirmed') {
    carrierMetaQuery = carrierMetaQuery.is('final_shipping_cost', null);
  }

  const { data: carrierMetaRows, error: carrierMetaError } = await carrierMetaQuery;
  if (carrierMetaError) {
    console.error('Failed to fetch carrier options:', carrierMetaError.message);
  }
  const carrierOptions = Array.from(
    new Set((carrierMetaRows || []).map((row) => row?.shipping_carrier).filter(Boolean))
  ).sort((a, b) => String(a).localeCompare(String(b)));

  let query = supabase
    .from('orders')
    .select(`
      id,
      order_no,
      order_date,
      ebay_user_id,
      buyer_country_code,
      status,
      shipping_status,
      shipping_tracking_number,
      shipping_carrier,
      estimated_shipping_cost,
      shipco_shipping_cost,
      final_shipping_cost,
      estimated_parcel_weight,
      estimated_parcel_length,
      estimated_parcel_width,
      estimated_parcel_height,
      shipco_parcel_weight,
      shipco_parcel_weight_unit,
      shipco_parcel_length,
      shipco_parcel_width,
      shipco_parcel_height,
      shipco_parcel_dimension_unit,
      order_line_items (
        legacy_item_id,
        title,
        item_image
      )
    `, { count: needsFinalShippingFilter ? undefined : 'exact' })
    .eq('user_id', user_id)
    .eq('shipping_status', 'SHIPPED')
    .order('order_date', { ascending: false });

  if (start_date) query = query.gte('order_date', start_date);
  if (end_date) query = query.lte('order_date', end_date);
  if (ebay_user_id) query = query.eq('ebay_user_id', ebay_user_id);
  if (shipping_carrier) query = query.eq('shipping_carrier', shipping_carrier);
  if (order_no) query = query.ilike('order_no', `%${order_no}%`);
  if (tracking_number) query = query.ilike('shipping_tracking_number', `%${tracking_number}%`);
  if (!needsFinalShippingFilter) {
    query = query.range(safeOffset, safeOffset + safeLimit - 1);
  }

  const { data, error, count } = await query;
  if (error) {
    console.error('Failed to fetch packing verification data:', error.message);
    throw error;
  }

  const rows = data || [];
  const trackingNumbers = Array.from(
    new Set(rows.map((row) => row.shipping_tracking_number).filter(Boolean))
  );
  const legacyItemIds = Array.from(
    new Set(
      rows
        .flatMap((row) => row.order_line_items || [])
        .map((item) => item?.legacy_item_id)
        .filter(Boolean)
    )
  );

  let itemsMap = {};
  if (legacyItemIds.length > 0) {
    const { data: itemsRows, error: itemsError } = await supabase
      .from('items')
      .select(`
        ebay_item_id,
        item_title,
        primary_image_url,
        estimated_shipping_cost,
        estimated_parcel_length,
        estimated_parcel_width,
        estimated_parcel_height,
        estimated_parcel_weight
      `)
      .in('ebay_item_id', legacyItemIds);

    if (!itemsError && Array.isArray(itemsRows)) {
      itemsMap = itemsRows.reduce((acc, item) => {
        acc[item.ebay_item_id] = item;
        return acc;
      }, {});
    }
  }

  let carrierTotalsMap = {};
  let carrierBreakdownMap = {};
  let carrierShipmentMap = {};
  if (trackingNumbers.length > 0) {
    const { data: shipmentRows, error: shipmentError } = await supabase
      .from('carrier_shipments')
      .select(`
        id,
        awb_number,
        created_at,
        carrier_actual_weight,
        carrier_actual_weight_unit,
        carrier_billed_weight,
        carrier_billed_weight_unit,
        carrier_dim_length,
        carrier_dim_width,
        carrier_dim_height,
        carrier_dim_unit
      `)
      .in('awb_number', trackingNumbers);

    if (!shipmentError && Array.isArray(shipmentRows) && shipmentRows.length > 0) {
      const shipmentIds = shipmentRows.map((row) => row.id).filter(Boolean);
      const awbByShipmentId = shipmentRows.reduce((acc, row) => {
        acc[row.id] = row.awb_number;
        return acc;
      }, {});

      const { data: chargeRows, error: chargeError } = await supabase
        .from('carrier_charges')
        .select('shipment_id, charge_group, amount')
        .in('shipment_id', shipmentIds);

      if (!chargeError && Array.isArray(chargeRows)) {
        carrierBreakdownMap = chargeRows.reduce((acc, row) => {
          const awb = awbByShipmentId[row.shipment_id];
          if (!awb) return acc;
          if (!acc[awb]) {
            acc[awb] = {
              shipping_amount: 0,
              other_amount: 0,
              fee_amount: 0,
              fee_tax_amount: 0,
              duty_amount: 0,
            };
          }
          const amount = toNumberOrNull(row.amount) || 0;
          const group = String(row.charge_group || '').toLowerCase();
          if (group === 'shipping') {
            acc[awb].shipping_amount += amount;
          } else if (group === 'other') {
            acc[awb].other_amount += amount;
          } else if (group === 'fee') {
            acc[awb].fee_amount += amount;
          } else if (group === 'fee_tax') {
            acc[awb].fee_tax_amount += amount;
          } else if (group === 'customs') {
            acc[awb].duty_amount += amount;
          }
          return acc;
        }, {});
        carrierTotalsMap = Object.keys(carrierBreakdownMap).reduce((acc, awb) => {
          const breakdown = carrierBreakdownMap[awb];
          acc[awb] = (breakdown?.shipping_amount || 0) + (breakdown?.other_amount || 0);
          return acc;
        }, {});
      }

      carrierShipmentMap = shipmentRows.reduce((acc, row) => {
        if (!row?.awb_number) return acc;
        const existing = acc[row.awb_number];
        if (!existing) {
          acc[row.awb_number] = row;
          return acc;
        }
        const existingTime = existing.created_at ? new Date(existing.created_at).getTime() : 0;
        const rowTime = row.created_at ? new Date(row.created_at).getTime() : 0;
        if (rowTime >= existingTime) {
          acc[row.awb_number] = row;
        }
        return acc;
      }, {});
    }
  }

  const resolveEstimatedValue = (row, key) => {
    const existing = toNumberOrNull(row[key]);
    if (existing !== null) return existing;
    const lineItems = row.order_line_items || [];
    for (const item of lineItems) {
      const legacyId = item?.legacy_item_id;
      if (!legacyId) continue;
      const fromItem = toNumberOrNull(itemsMap[legacyId]?.[key]);
      if (fromItem !== null) return fromItem;
    }
    return null;
  };

  const mapped = rows.map((row) => ({
      ...row,
      item_title: (() => {
        const lineItems = row.order_line_items || [];
        for (const item of lineItems) {
          const directTitle = item?.title;
          if (directTitle) return directTitle;
          const legacyId = item?.legacy_item_id;
          if (!legacyId) continue;
          const title = itemsMap[legacyId]?.item_title;
          if (title) return title;
        }
        return null;
      })(),
      primary_image_url: (() => {
        const lineItems = row.order_line_items || [];
        for (const item of lineItems) {
          const directImage = item?.item_image;
          if (directImage) return directImage;
          const legacyId = item?.legacy_item_id;
          if (!legacyId) continue;
          const url = itemsMap[legacyId]?.primary_image_url;
          if (url) return url;
        }
        return null;
      })(),
      estimated_shipping_cost: resolveEstimatedValue(row, 'estimated_shipping_cost'),
      shipco_shipping_cost: toNumberOrNull(row.shipco_shipping_cost),
      final_shipping_cost:
        toNumberOrNull(row.final_shipping_cost) ??
        toNumberOrNull(carrierTotalsMap[row.shipping_tracking_number]),
      confirmed_shipping_amount:
        row.shipping_tracking_number ? toNumberOrNull(carrierBreakdownMap[row.shipping_tracking_number]?.shipping_amount) : null,
      confirmed_other_amount:
        row.shipping_tracking_number ? toNumberOrNull(carrierBreakdownMap[row.shipping_tracking_number]?.other_amount) : null,
      confirmed_fee_amount:
        row.shipping_tracking_number ? toNumberOrNull(carrierBreakdownMap[row.shipping_tracking_number]?.fee_amount) : null,
      confirmed_fee_tax_amount:
        row.shipping_tracking_number ? toNumberOrNull(carrierBreakdownMap[row.shipping_tracking_number]?.fee_tax_amount) : null,
      confirmed_shipping_amount_incl_fee:
        row.shipping_tracking_number
          ? toNumberOrNull(
            (carrierBreakdownMap[row.shipping_tracking_number]?.shipping_amount || 0)
            + (carrierBreakdownMap[row.shipping_tracking_number]?.other_amount || 0)
            + (carrierBreakdownMap[row.shipping_tracking_number]?.fee_amount || 0)
            + (carrierBreakdownMap[row.shipping_tracking_number]?.fee_tax_amount || 0)
          )
          : null,
      confirmed_duty_amount:
        row.shipping_tracking_number ? toNumberOrNull(carrierBreakdownMap[row.shipping_tracking_number]?.duty_amount) : null,
      carrier_actual_weight:
        row.shipping_tracking_number ? toNumberOrNull(carrierShipmentMap[row.shipping_tracking_number]?.carrier_actual_weight) : null,
      carrier_actual_weight_unit:
        row.shipping_tracking_number ? (carrierShipmentMap[row.shipping_tracking_number]?.carrier_actual_weight_unit || null) : null,
      carrier_billed_weight:
        row.shipping_tracking_number ? toNumberOrNull(carrierShipmentMap[row.shipping_tracking_number]?.carrier_billed_weight) : null,
      carrier_billed_weight_unit:
        row.shipping_tracking_number ? (carrierShipmentMap[row.shipping_tracking_number]?.carrier_billed_weight_unit || null) : null,
      carrier_dim_length:
        row.shipping_tracking_number ? toNumberOrNull(carrierShipmentMap[row.shipping_tracking_number]?.carrier_dim_length) : null,
      carrier_dim_width:
        row.shipping_tracking_number ? toNumberOrNull(carrierShipmentMap[row.shipping_tracking_number]?.carrier_dim_width) : null,
      carrier_dim_height:
        row.shipping_tracking_number ? toNumberOrNull(carrierShipmentMap[row.shipping_tracking_number]?.carrier_dim_height) : null,
      carrier_dim_unit:
        row.shipping_tracking_number ? (carrierShipmentMap[row.shipping_tracking_number]?.carrier_dim_unit || null) : null,
      estimated_parcel_weight: resolveEstimatedValue(row, 'estimated_parcel_weight'),
      estimated_parcel_length: resolveEstimatedValue(row, 'estimated_parcel_length'),
      estimated_parcel_width: resolveEstimatedValue(row, 'estimated_parcel_width'),
      estimated_parcel_height: resolveEstimatedValue(row, 'estimated_parcel_height'),
      shipco_parcel_weight: toNumberOrNull(row.shipco_parcel_weight),
      shipco_parcel_length: toNumberOrNull(row.shipco_parcel_length),
      shipco_parcel_width: toNumberOrNull(row.shipco_parcel_width),
      shipco_parcel_height: toNumberOrNull(row.shipco_parcel_height),
    }));

  if (!needsFinalShippingFilter) {
    return {
      data: mapped,
      total: count || 0,
      meta: {
        carriers: carrierOptions,
      },
    };
  }

  const filtered = mapped.filter((row) => {
    const hasConfirmed = row.final_shipping_cost !== null && row.final_shipping_cost !== undefined;
    if (normalizedFinalShippingStatus === 'confirmed') return hasConfirmed;
    if (normalizedFinalShippingStatus === 'unconfirmed') return !hasConfirmed;
    return true;
  });

  return {
    data: filtered.slice(safeOffset, safeOffset + safeLimit),
    total: filtered.length,
    meta: {
      carriers: carrierOptions,
    },
  };
};

exports.fetchCarrierRates = async (filters = {}) => {
  const {
    limit = 200,
    offset = 0,
    carrier,
    service,
    destination_scope,
    zone,
    is_active,
    include_meta = false,
    include_all = false,
  } = filters;

  const safeLimit = Number.isFinite(Number(limit)) ? Math.min(Number(limit), 500) : 200;
  const safeOffset = Number.isFinite(Number(offset)) ? Math.max(Number(offset), 0) : 0;

  let query = supabase
    .from('shipping_rates')
    .select('*', { count: 'exact' })
    .order('last_synced_at', { ascending: false })
    .order('created_at', { ascending: false });

  if (!include_all) {
    query = query.range(safeOffset, safeOffset + safeLimit - 1);
  }

  if (carrier) query = query.eq('carrier', carrier);
  if (service) query = query.ilike('service_code', `%${service}%`);
  if (destination_scope) query = query.eq('destination_scope', destination_scope);
  if (zone !== undefined && zone !== null && zone !== '') {
    query = query.eq('zone', Number(zone));
  }
  if (is_active !== undefined && is_active !== null && is_active !== '') {
    query = query.eq('is_active', String(is_active) === 'true');
  }

  const { data, error, count } = await query;
  if (error) {
    console.error('Failed to fetch carrier rates:', error.message);
    throw error;
  }

  let meta = {};
  if (include_meta) {
    let servicesQuery = supabase
      .from('shipping_rates')
      .select('service_code, service_name')
      .order('service_code', { ascending: true });

    if (carrier) servicesQuery = servicesQuery.eq('carrier', carrier);
    if (destination_scope) servicesQuery = servicesQuery.eq('destination_scope', destination_scope);
    if (zone !== undefined && zone !== null && zone !== '') {
      servicesQuery = servicesQuery.eq('zone', Number(zone));
    }
    if (is_active !== undefined && is_active !== null && is_active !== '') {
      servicesQuery = servicesQuery.eq('is_active', String(is_active) === 'true');
    }

    const { data: serviceRows, error: serviceError } = await servicesQuery;
    if (serviceError) {
      console.error('Failed to fetch carrier rate services:', serviceError.message);
    } else {
      const serviceMap = new Map();
      (serviceRows || []).forEach((row) => {
        if (!row?.service_code || serviceMap.has(row.service_code)) return;
        serviceMap.set(row.service_code, row.service_name || row.service_code);
      });
      meta.services = Array.from(serviceMap.entries()).map(([value, label]) => ({ value, label }));
    }

    let carriersQuery = supabase
      .from('shipping_rates')
      .select('carrier')
      .order('carrier', { ascending: true });
    if (service) carriersQuery = carriersQuery.ilike('service_code', `%${service}%`);
    if (destination_scope) carriersQuery = carriersQuery.eq('destination_scope', destination_scope);
    if (zone !== undefined && zone !== null && zone !== '') {
      carriersQuery = carriersQuery.eq('zone', Number(zone));
    }
    if (is_active !== undefined && is_active !== null && is_active !== '') {
      carriersQuery = carriersQuery.eq('is_active', String(is_active) === 'true');
    }
    const { data: carrierRows, error: carrierError } = await carriersQuery;
    if (carrierError) {
      console.error('Failed to fetch carrier rate carriers:', carrierError.message);
    } else {
      meta.carriers = Array.from(
        new Set((carrierRows || []).map((row) => row?.carrier).filter(Boolean))
      );
    }
  }

  return {
    data: data || [],
    total: count || 0,
    meta,
  };
};
