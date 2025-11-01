const axios = require('axios');
const { logError } = require('./loggingService');

const SHIP_AND_CO_API_URL = process.env.SHIPANDCO_API_URL || 'https://api.shipandco.com/v1';
const SHIP_AND_CO_API_TOKEN = process.env.SHIPANDCO_API_TOKEN || process.env.SHIPANDCO_API_KEY || null;
const SHIP_AND_CO_DEFAULT_LIMIT = Number(process.env.SHIPANDCO_FETCH_LIMIT) || 100;

const buildClient = () => {
    if (!SHIP_AND_CO_API_TOKEN) {
        return null;
    }

    return axios.create({
        baseURL: SHIP_AND_CO_API_URL,
        headers: {
            'x-access-token': SHIP_AND_CO_API_TOKEN,
            'Content-Type': 'application/json',
        },
        timeout: 20_000,
    });
};

const normalizeString = (value) => {
    if (value === undefined || value === null) {
        return '';
    }
    return String(value).trim();
};

const normalizeComparable = (value) => normalizeString(value).toLowerCase();
const normalizeComparableLoose = (value) =>
    normalizeString(value)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');

const shipmentMatchesReference = (shipment = {}, reference) => {
    if (!reference) {
        return true;
    }
    const targetStrict = normalizeComparable(reference);
    const targetLoose = normalizeComparableLoose(reference);
    const candidates = [
        shipment.id,
        shipment.reference,
        shipment.order_id,
        shipment.orderId,
        shipment.order_reference,
        shipment.orderReference,
        shipment.order_number,
        shipment.orderNumber,
        shipment.shipment_reference,
        shipment.shipmentReference,
        shipment?.setup?.ref_number,
        shipment?.setup?.refNumber,
    ];
    return candidates.some((candidate) => {
        if (!candidate) return false;
        const strict = normalizeComparable(candidate);
        if (strict && strict === targetStrict) {
            return true;
        }
        const loose = normalizeComparableLoose(candidate);
        return loose && loose === targetLoose;
    });
};

const extractTrackingNumbersFromDelivery = (delivery = {}) => {
    if (!delivery || typeof delivery !== 'object') {
        return [];
    }
    const direct = delivery.tracking_number || delivery.trackingNumber;
    const list = Array.isArray(delivery.tracking_numbers) ? delivery.tracking_numbers : [];
    const combined = [];
    if (direct && normalizeString(direct)) {
        combined.push(normalizeString(direct));
    }
    list.forEach((item) => {
        const normalized = normalizeString(item);
        if (normalized) {
            combined.push(normalized);
        }
    });
    return combined;
};

const extractTrackingFromShipment = (shipment = {}) => {
    if (!shipment || typeof shipment !== 'object') {
        return null;
    }

    const direct =
        shipment.tracking_number ||
        shipment.trackingNumber ||
        shipment.shipment_tracking_number ||
        shipment.shipmentTrackingNumber ||
        null;

    if (direct && normalizeString(direct)) {
        return normalizeString(direct);
    }

    const deliveryNumbers = extractTrackingNumbersFromDelivery(shipment.delivery);
    if (deliveryNumbers.length > 0) {
        return deliveryNumbers[0];
    }

    const parcels = Array.isArray(shipment.parcels) ? shipment.parcels : [];
    for (const parcel of parcels) {
        const candidate =
            parcel?.tracking_number ||
            parcel?.trackingNumber ||
            parcel?.shipment_tracking_number ||
            parcel?.shipmentTrackingNumber ||
            null;
        if (candidate && normalizeString(candidate)) {
            return normalizeString(candidate);
        }
    }

    return null;
};

const extractDeliveryRateFromShipment = (shipment = {}) => {
    const delivery = shipment?.delivery;
    if (!delivery || typeof delivery !== 'object') {
        return { amount: null, currency: null };
    }
    const rawRate = delivery.rate;
    const currency = typeof delivery.currency === 'string' ? delivery.currency : null;
    const rateNumber =
        rawRate === undefined || rawRate === null
            ? null
            : Number.isFinite(Number(rawRate))
                ? Number(rawRate)
                : null;

    return {
        amount: rateNumber,
        currency,
    };
};

const fetchShipmentDetailsByReference = async (reference) => {
    if (!reference) {
        return null;
    }
    const client = buildClient();
    if (!client) {
        console.warn('[shipcoService] Ship&Co client is not configured. Missing SHIPANDCO_API_TOKEN?');
        return null;
    }
    try {
        const params = {
            scope: 'all',
            reference,
            limit: SHIP_AND_CO_DEFAULT_LIMIT,
        };
        console.info('[shipcoService] Fetching Ship&Co shipments with params:', params);
        const response = await client.get('/shipments', { params });
        const data = response.data || {};
        const shipments = Array.isArray(data.shipments) ? data.shipments : Array.isArray(data) ? data : [];
        console.info('[shipcoService] Received shipments:', shipments.length);

        const matchingShipments = shipments.filter((shipment) =>
            shipmentMatchesReference(shipment, reference)
        );
        console.info(
            `[shipcoService] Matching shipments for reference ${reference}:`,
            matchingShipments.length
        );

        const targetShipment = matchingShipments[0];
        if (!targetShipment) {
            console.warn(
                `[shipcoService] No matching shipment found for reference ${reference}.`
            );
            return null;
        }
        const tracking = extractTrackingFromShipment(targetShipment);
        const deliveryRate = extractDeliveryRateFromShipment(targetShipment);

        if (tracking) {
            console.info(
                `[shipcoService] Extracted tracking number for reference ${reference}:`,
                tracking
            );
        } else {
            console.warn(
                `[shipcoService] No tracking number found in shipment for reference ${reference}`
            );
        }
        if (deliveryRate.amount !== null) {
            console.info(
                `[shipcoService] Extracted shipping cost for reference ${reference}:`,
                `${deliveryRate.amount}${deliveryRate.currency ? ` ${deliveryRate.currency}` : ''}`
            );
        } else {
            console.warn(
                `[shipcoService] No shipping cost found in shipment for reference ${reference}`
            );
        }

        return {
            trackingNumber: tracking || null,
            deliveryRate: deliveryRate.amount,
            deliveryCurrency: deliveryRate.currency,
        };
    } catch (error) {
        logError('shipcoService.fetchTrackingByReference', error);
        console.error('[shipcoService] Failed to fetch tracking by reference:', reference, error?.message || error);
        return null;
    }
};

exports.fetchShipmentDetailsByReference = fetchShipmentDetailsByReference;

exports.fetchTrackingByReference = async (reference) => {
    const details = await fetchShipmentDetailsByReference(reference);
    return details ? details.trackingNumber || null : null;
};
