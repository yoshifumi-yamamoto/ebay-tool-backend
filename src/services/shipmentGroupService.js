const supabase = require('../supabaseClient');
const shipcoService = require('./shipcoService');
const orderService = require('./orderService');
const {
    buildShipcoAddress,
    buildDefaultParcel,
    buildDefaultCustoms,
    normalizeParcels,
    buildRatePayload,
} = require('./shipcoPayloadBuilder');

const normalizeString = (value) => (value === undefined || value === null ? '' : String(value).trim());

const fetchGroupOrders = async (groupId, userId) => {
    const { data: group, error: groupError } = await supabase
        .from('shipment_groups')
        .select('id, user_id, status, primary_order_no')
        .eq('id', groupId)
        .maybeSingle();
    if (groupError || !group) {
        throw new Error('Shipment group not found');
    }
    if (userId && group.user_id !== userId) {
        throw new Error('Shipment group not found for user');
    }
    const { data: links, error: linkError } = await supabase
        .from('shipment_group_orders')
        .select('order_no')
        .eq('group_id', groupId);
    if (linkError) {
        throw new Error(`Failed to fetch shipment group orders: ${linkError.message}`);
    }
    const orderNos = (links || []).map((row) => row.order_no).filter(Boolean);
    if (orderNos.length === 0) {
        throw new Error('Shipment group has no orders');
    }
    const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select('order_no, ship_to, subtotal, subtotal_currency, total_amount_currency, earnings, earnings_currency, shipco_parcel_weight, shipco_parcel_length, shipco_parcel_width, shipco_parcel_height, estimated_parcel_weight, estimated_parcel_length, estimated_parcel_width, estimated_parcel_height, order_line_items(title, quantity)')
        .in('order_no', orderNos);
    if (ordersError) {
        throw new Error(`Failed to fetch orders: ${ordersError.message}`);
    }
    return { group, orders: orders || [], orderNos };
};


async function estimateRates(groupId, userId, payload = {}) {
    const { from_address, to_address, parcels, products, customs, setup } = payload;
    if (!from_address) {
        throw new Error('from_address is required');
    }
    const { orders } = await fetchGroupOrders(groupId, userId);
    const primaryOrder = orders[0];
    const toAddress = to_address || buildShipcoAddress(primaryOrder?.ship_to || {});
    const resolvedParcels = Array.isArray(parcels) && parcels.length > 0
        ? parcels
        : (() => {
            const defaultParcel = buildDefaultParcel(primaryOrder || {});
            return defaultParcel ? [defaultParcel] : [];
        })();
    if (resolvedParcels.length === 0) {
        throw new Error('parcel info is required');
    }

    const normalizedParcels = normalizeParcels(resolvedParcels);
    const requestPayload = buildRatePayload({
        toAddress,
        fromAddress: from_address,
        parcels: normalizedParcels,
        products: products || [],
        customs: customs || undefined,
        setup: setup || {},
    });
    const isInternational =
        from_address?.country &&
        toAddress?.country &&
        String(from_address.country).toUpperCase() !== String(toAddress.country).toUpperCase();
    if (isInternational && (!products || products.length === 0 || !customs)) {
        const defaults = buildDefaultCustoms(primaryOrder || {}, setup || {});
        requestPayload.products = defaults.products;
        requestPayload.customs = defaults.customs;
        if (!requestPayload.setup?.currency) {
            requestPayload.setup = { ...(requestPayload.setup || {}), currency: defaults.products[0].currency };
        }
    }
    console.info('[shipmentGroupService] rate payload', {
        groupId,
        userId,
        payload: requestPayload,
    });
    return await shipcoService.fetchRates(requestPayload);
}

async function createShipmentForGroup(groupId, userId, payload = {}) {
    const { from_address, to_address, parcels, products, customs, setup } = payload;
    if (!from_address) {
        throw new Error('from_address is required');
    }
    if (!setup || !setup.carrier || !setup.service) {
        throw new Error('setup.carrier and setup.service are required');
    }
    const { group, orders, orderNos } = await fetchGroupOrders(groupId, userId);
    const primaryOrder = orders[0];
    const toAddress = to_address || buildShipcoAddress(primaryOrder?.ship_to || {});
    const resolvedParcels = Array.isArray(parcels) && parcels.length > 0
        ? parcels
        : (() => {
            const defaultParcel = buildDefaultParcel(primaryOrder || {});
            return defaultParcel ? [defaultParcel] : [];
        })();
    if (resolvedParcels.length === 0) {
        throw new Error('parcel info is required');
    }

    const normalizedParcels = normalizeParcels(resolvedParcels);
    const requestPayload = buildRatePayload({
        toAddress,
        fromAddress: from_address,
        parcels: normalizedParcels,
        products: products || [],
        customs: customs || undefined,
        setup,
    });
    const isInternational =
        from_address?.country &&
        toAddress?.country &&
        String(from_address.country).toUpperCase() !== String(toAddress.country).toUpperCase();
    if (isInternational && (!products || products.length === 0 || !customs)) {
        const defaults = buildDefaultCustoms(primaryOrder || {}, setup || {});
        requestPayload.products = defaults.products;
        requestPayload.customs = defaults.customs;
        if (!requestPayload.setup?.currency) {
            requestPayload.setup = { ...(requestPayload.setup || {}), currency: defaults.products[0].currency };
        }
    }

    const shipment = await shipcoService.createShipment(requestPayload);
    const trackingNumber = shipcoService.extractTrackingFromShipment(shipment);
    const carrierCode = shipcoService.extractCarrierFromShipment(shipment);
    const labelUrl = shipment?.delivery?.label || null;
    if (!trackingNumber || !carrierCode) {
        throw new Error('tracking number or carrier code missing from Ship&Co response');
    }

    for (const orderNo of orderNos) {
        await orderService.uploadTrackingInfoToEbay({
            orderNo,
            trackingNumber,
            carrierCode,
        });
    }

    const { error: updateError } = await supabase
        .from('shipment_groups')
        .update({
            status: 'shipped',
            tracking_number: trackingNumber,
            label_url: labelUrl,
            shipment_id: shipment?.id || null,
            shipping_carrier: carrierCode,
            shipped_at: new Date().toISOString(),
        })
        .eq('id', group.id);
    if (updateError) {
        throw new Error(`Failed to update shipment group: ${updateError.message}`);
    }

    return { shipment, trackingNumber, carrierCode, labelUrl };
}

async function listShipmentGroups(userId, status = 'draft') {
    let query = supabase
        .from('shipment_groups')
        .select('id, user_id, status, primary_order_no, tracking_number, label_url, shipment_id, shipping_carrier, shipped_at, created_at, shipment_group_orders(order_no)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

    if (status) {
        query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) {
        throw new Error(`Failed to fetch shipment groups: ${error.message}`);
    }
    return data || [];
}

async function fetchShipmentGroupDetails(groupId, userId) {
    const { group, orders, orderNos } = await fetchGroupOrders(groupId, userId);
    return {
        group,
        orders,
        orderNos,
    };
}

async function createShipmentGroup(userId, orderNos, primaryOrderNo) {
    if (!Array.isArray(orderNos) || orderNos.length === 0) {
        throw new Error('orderNos is required');
    }
    if (orderNos.length < 2) {
        throw new Error('Shipment group requires at least two orders');
    }

    const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select('order_no, ebay_buyer_id, user_id')
        .eq('user_id', userId)
        .in('order_no', orderNos);
    if (ordersError) {
        throw new Error(`Failed to validate orders: ${ordersError.message}`);
    }
    const foundOrderNos = new Set((orders || []).map((order) => order.order_no));
    const missingOrderNos = orderNos.filter((orderNo) => !foundOrderNos.has(orderNo));
    if (missingOrderNos.length > 0) {
        throw new Error(`Orders not found: ${missingOrderNos.join(',')}`);
    }
    const buyerIds = new Set((orders || []).map((order) => normalizeString(order.ebay_buyer_id)).filter(Boolean));
    if (buyerIds.size !== 1) {
        throw new Error('Shipment group must contain orders from the same buyer');
    }
    const primary = primaryOrderNo || orderNos[0];

    const { data: group, error: groupError } = await supabase
        .from('shipment_groups')
        .insert({
            user_id: userId,
            status: 'draft',
            primary_order_no: primary,
        })
        .select('id')
        .maybeSingle();

    if (groupError) {
        throw new Error(`Failed to create shipment group: ${groupError.message}`);
    }

    const groupId = group?.id;
    const rows = orderNos.map((orderNo) => ({
        group_id: groupId,
        order_no: orderNo,
    }));
    const { error: linkError } = await supabase
        .from('shipment_group_orders')
        .insert(rows);
    if (linkError) {
        throw new Error(`Failed to link orders to shipment group: ${linkError.message}`);
    }

    return { id: groupId, order_nos: orderNos, primary_order_no: primary };
}

module.exports = {
    listShipmentGroups,
    fetchShipmentGroupDetails,
    createShipmentGroup,
    estimateRates,
    createShipmentForGroup,
};
