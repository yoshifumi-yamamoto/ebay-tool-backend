const supabase = require('../supabaseClient');
const shipcoService = require('./shipcoService');
const orderService = require('./orderService');

const normalizeString = (value) => (value === undefined || value === null ? '' : String(value).trim());

const buildShipcoAddress = (shipTo = {}) => {
    const contact = shipTo.contactAddress || shipTo.contact_address || {};
    return {
        full_name: shipTo.fullName || shipTo.full_name || shipTo.name || null,
        phone: shipTo.phoneNumber || shipTo.phone || contact.phone || null,
        email: shipTo.email || contact.email || null,
        company: contact.companyName || contact.company || null,
        country: contact.countryCode || shipTo.countryCode || shipTo.country || null,
        zip: contact.postalCode || shipTo.postalCode || shipTo.zip || null,
        province: contact.stateOrProvince || shipTo.state || shipTo.province || null,
        city: contact.city || shipTo.city || null,
        address1: contact.addressLine1 || shipTo.address1 || null,
        address2: contact.addressLine2 || shipTo.address2 || null,
        address3: contact.addressLine3 || shipTo.address3 || null,
    };
};

const buildDefaultParcel = (order = {}) => {
    const weight = order.shipco_parcel_weight || order.estimated_parcel_weight || null;
    const length = order.shipco_parcel_length || order.estimated_parcel_length || null;
    const width = order.shipco_parcel_width || order.estimated_parcel_width || null;
    const height = order.shipco_parcel_height || order.estimated_parcel_height || null;
    if (!weight && !length && !width && !height) {
        return null;
    }
    return {
        weight: Number(weight) || 0,
        width: Number(width) || 0,
        height: Number(height) || 0,
        depth: Number(length) || 0,
    };
};

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
        .select('order_no, ship_to, shipco_parcel_weight, shipco_parcel_length, shipco_parcel_width, shipco_parcel_height, estimated_parcel_weight, estimated_parcel_length, estimated_parcel_width, estimated_parcel_height')
        .in('order_no', orderNos);
    if (ordersError) {
        throw new Error(`Failed to fetch orders: ${ordersError.message}`);
    }
    return { group, orders: orders || [], orderNos };
};

const buildRatePayload = ({ toAddress, fromAddress, parcels, products, customs, setup }) => ({
    to_address: toAddress,
    from_address: fromAddress,
    parcels,
    products,
    customs,
    setup,
});

async function estimateRates(groupId, userId, payload = {}) {
    const { from_address, parcels, products, customs, setup } = payload;
    if (!from_address) {
        throw new Error('from_address is required');
    }
    const { orders } = await fetchGroupOrders(groupId, userId);
    const primaryOrder = orders[0];
    const toAddress = buildShipcoAddress(primaryOrder?.ship_to || {});
    const resolvedParcels = Array.isArray(parcels) && parcels.length > 0
        ? parcels
        : (() => {
            const defaultParcel = buildDefaultParcel(primaryOrder || {});
            return defaultParcel ? [defaultParcel] : [];
        })();
    if (resolvedParcels.length === 0) {
        throw new Error('parcel info is required');
    }

    const requestPayload = buildRatePayload({
        toAddress,
        fromAddress: from_address,
        parcels: resolvedParcels,
        products: products || [],
        customs: customs || undefined,
        setup: setup || {},
    });
    return await shipcoService.fetchRates(requestPayload);
}

async function createShipmentForGroup(groupId, userId, payload = {}) {
    const { from_address, parcels, products, customs, setup } = payload;
    if (!from_address) {
        throw new Error('from_address is required');
    }
    if (!setup || !setup.carrier || !setup.service) {
        throw new Error('setup.carrier and setup.service are required');
    }
    const { group, orders, orderNos } = await fetchGroupOrders(groupId, userId);
    const primaryOrder = orders[0];
    const toAddress = buildShipcoAddress(primaryOrder?.ship_to || {});
    const resolvedParcels = Array.isArray(parcels) && parcels.length > 0
        ? parcels
        : (() => {
            const defaultParcel = buildDefaultParcel(primaryOrder || {});
            return defaultParcel ? [defaultParcel] : [];
        })();
    if (resolvedParcels.length === 0) {
        throw new Error('parcel info is required');
    }

    const requestPayload = buildRatePayload({
        toAddress,
        fromAddress: from_address,
        parcels: resolvedParcels,
        products: products || [],
        customs: customs || undefined,
        setup,
    });

    const shipment = await shipcoService.createShipment(requestPayload);
    const trackingNumber = shipcoService.extractTrackingFromShipment(shipment);
    const carrierCode = shipcoService.extractCarrierFromShipment(shipment);
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
            shipping_carrier: carrierCode,
            shipped_at: new Date().toISOString(),
        })
        .eq('id', group.id);
    if (updateError) {
        throw new Error(`Failed to update shipment group: ${updateError.message}`);
    }

    return { shipment, trackingNumber, carrierCode };
}

async function listShipmentGroups(userId, status = 'draft') {
    let query = supabase
        .from('shipment_groups')
        .select('id, user_id, status, primary_order_no, tracking_number, shipping_carrier, shipped_at, created_at, shipment_group_orders(order_no)')
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

async function createShipmentGroup(userId, orderNos, primaryOrderNo) {
    if (!Array.isArray(orderNos) || orderNos.length === 0) {
        throw new Error('orderNos is required');
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
    createShipmentGroup,
    estimateRates,
    createShipmentForGroup,
};
