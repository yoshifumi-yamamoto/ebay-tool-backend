const axios = require('axios');
const supabase = require('../supabaseClient');
const { getAccountById, refreshEbayToken } = require('./accountService');
const {
    fetchActiveListings,
    refreshEbayToken: refreshTradingToken,
    updateItemsTable,
    fetchItemDetails,
} = require('./itemService');

const EBAY_MARKETING_API_BASE = 'https://api.ebay.com/sell/marketing/v1';
const PRL_ACCOUNT_CONCURRENCY = 4;
const NEGOTIATION_API_BASE = 'https://api.ebay.com/sell/negotiation/v1';
const SEND_OFFER_BACKFILL_MAX_PAGES = Number(process.env.SEND_OFFER_BACKFILL_MAX_PAGES || 10);
const SEND_OFFER_DETAIL_BACKFILL_MAX = Number(process.env.SEND_OFFER_DETAIL_BACKFILL_MAX || 50);

const normalizeEbayDateTime = (value) => {
    if (!value) return null;
    const normalized = typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, '_')
        ? value._
        : value;
    const iso = String(normalized || '').trim();
    if (!iso) return null;
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
};

const convertIsoToJstTimestamp = (value) => {
    const iso = normalizeEbayDateTime(value);
    if (!iso) return null;
    const parsed = new Date(iso);
    const formatter = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    });
    const parts = formatter.formatToParts(parsed).reduce((acc, part) => {
        if (part.type !== 'literal') acc[part.type] = part.value;
        return acc;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
};

const normalizeLegacyItemId = (value) => {
    if (value === null || value === undefined) return null;
    const raw = String(value).trim();
    if (!raw) return null;

    const candidates = [];
    const addCandidate = (candidate) => {
        const normalized = candidate === null || candidate === undefined ? '' : String(candidate).trim();
        if (!normalized) return;
        if (!candidates.includes(normalized)) {
            candidates.push(normalized);
        }
    };

    addCandidate(raw);

    // Common eBay REST forms:
    // - v1|123456789012|0
    // - https://api.ebay.com/buy/browse/v1/item/v1|123456789012|0
    // - /buy/browse/v1/item/v1|123456789012|0
    const lastPathToken = raw.split('/').filter(Boolean).pop();
    addCandidate(lastPathToken);

    const pipeMatch = raw.match(/(?:^|\/)v1\|(\d+)\|\d+$/i);
    if (pipeMatch?.[1]) {
        addCandidate(pipeMatch[1]);
    }

    const trailingDigitsMatch = raw.match(/(\d{9,})$/);
    if (trailingDigitsMatch?.[1]) {
        addCandidate(trailingDigitsMatch[1]);
    }

    return candidates[0] || null;
};

const collectLegacyItemIdCandidates = (value) => {
    if (value === null || value === undefined) return [];
    const raw = String(value).trim();
    if (!raw) return [];

    const candidates = [];
    const addCandidate = (candidate) => {
        const normalized = candidate === null || candidate === undefined ? '' : String(candidate).trim();
        if (!normalized) return;
        if (!candidates.includes(normalized)) {
            candidates.push(normalized);
        }
    };

    addCandidate(raw);

    const normalized = normalizeLegacyItemId(raw);
    addCandidate(normalized);

    const lastPathToken = raw.split('/').filter(Boolean).pop();
    addCandidate(lastPathToken);

    const pipeMatch = raw.match(/(?:^|\/)v1\|(\d+)\|\d+$/i);
    if (pipeMatch?.[1]) {
        addCandidate(pipeMatch[1]);
    }

    const trailingDigitsMatch = raw.match(/(\d{9,})$/);
    if (trailingDigitsMatch?.[1]) {
        addCandidate(trailingDigitsMatch[1]);
    }

    return candidates;
};

const hasUsableItemData = (row) => {
    if (!row) return false;
    const hasTitle = !!String(row.item_title || '').trim();
    const hasPrice = row.current_price_value !== null && row.current_price_value !== undefined && String(row.current_price_value).trim() !== '';
    const hasImage = !!String(row.primary_image_url || '').trim();
    return hasTitle || hasPrice || hasImage;
};

async function getSendOfferEligibleItems(accountId, { limit = 20, offset = 0 } = {}) {
    if (!accountId) {
        throw new Error('accountId is required');
    }

    const account = await getAccountById(accountId);
    if (!account) {
        throw new Error('Account not found');
    }
    if (!account.refresh_token) {
        throw new Error('Account does not have a refresh token');
    }

    const accessToken = await refreshEbayToken(account.refresh_token);
    const safeLimit = Math.min(Math.max(Number(limit) || 0, 1), 200);
    const safeOffset = Math.max(Number(offset) || 0, 0);
    const marketplaceId = account.marketplace_id || process.env.EBAY_MARKETPLACE_ID || 'EBAY_US';

    const url = `${NEGOTIATION_API_BASE}/find_eligible_items`;

    try {
        const { data } = await axios.get(url, {
            params: { limit: safeLimit, offset: safeOffset },
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'X-EBAY-C-MARKETPLACE-ID': marketplaceId,
                'Accept-Language': 'en-US'
            }
        });
        const eligibleItems = data?.eligibleItemSummaries || data?.eligibleItems || data?.items || [];
        if (!Array.isArray(eligibleItems) || eligibleItems.length === 0) {
            return data;
        }

        const itemIdCandidatesByLookupId = {};
        const lookupIds = eligibleItems
            .map((item) => String(item?.itemId || item?.listingId || '').trim())
            .filter(Boolean);
        const uniqueLookupIds = Array.from(new Set(lookupIds));
        const uniqueItemIds = Array.from(new Set(
            uniqueLookupIds.flatMap((lookupId) => {
                const candidates = collectLegacyItemIdCandidates(lookupId);
                itemIdCandidatesByLookupId[lookupId] = candidates;
                return candidates;
            })
        ));
        const itemMap = {};
        const setItemMapRow = (sourceId, row) => {
            for (const candidate of collectLegacyItemIdCandidates(sourceId)) {
                itemMap[candidate] = row;
            }
        };

        // eBay API response can be sparse (itemId only), so enrich from local items table.
        const enrichByIds = async (chunk, mode = 'strict') => {
            let query = supabase
                .from('items')
                .select('ebay_item_id, item_title, current_price_value, current_price_currency, primary_image_url')
                .in('ebay_item_id', chunk);
            if (mode === 'strict') {
                query = query
                    .eq('user_id', account.user_id)
                    .eq('ebay_user_id', account.ebay_user_id);
            } else if (mode === 'user_only') {
                query = query.eq('user_id', account.user_id);
            }
            const { data: rows, error } = await query;
            if (error) throw error;
            for (const row of rows || []) {
                const rowId = String(row.ebay_item_id);
                for (const candidate of collectLegacyItemIdCandidates(rowId)) {
                    if (!itemMap[candidate] || !hasUsableItemData(itemMap[candidate])) {
                        itemMap[candidate] = row;
                    }
                }
            }
            return (rows || []).length;
        };

        const enrichFromDb = async () => {
            for (let i = 0; i < uniqueItemIds.length; i += 500) {
                const chunk = uniqueItemIds.slice(i, i + 500);
                try {
                    const matched = await enrichByIds(chunk, 'strict');
                    // Fallback 1: ebay_user_id mismatch.
                    if (matched === 0) {
                        const matchedUserOnly = await enrichByIds(chunk, 'user_only');
                        // Fallback 2: data belongs to another user_id row (legacy import etc).
                        if (matchedUserOnly === 0) {
                            await enrichByIds(chunk, 'global');
                        }
                    }
                } catch (error) {
                    throw new Error(`Failed to enrich eligible items: ${error.message}`);
                }
            }
        };

        await enrichFromDb();

        const missingIds = uniqueItemIds.filter((id) => !hasUsableItemData(itemMap[id]));
        let backfillStats = null;
        // Backfill only missing listings by scanning active listings pages and upserting matches.
        if (missingIds.length > 0) {
            const missingSet = new Set(missingIds);
            let scannedPages = 0;
            let foundInEbay = 0;
            let filledByGetItem = 0;
            try {
                const tradingToken = await refreshTradingToken(account.refresh_token);
                for (let page = 1; page <= Math.max(1, SEND_OFFER_BACKFILL_MAX_PAGES); page += 1) {
                    const pageData = await fetchActiveListings(tradingToken, page, 100);
                    scannedPages += 1;
                    const listings = pageData?.listings || [];
                    const matchedListings = listings.filter((listing) => {
                        const listingCandidates = collectLegacyItemIdCandidates(listing?.legacyItemId);
                        return listingCandidates.some((candidate) => missingSet.has(candidate));
                    });
                    if (matchedListings.length > 0) {
                        foundInEbay += matchedListings.length;
                        await updateItemsTable(matchedListings, account.user_id, account.ebay_user_id);
                        for (const listing of matchedListings) {
                            setItemMapRow(listing?.legacyItemId, {
                                ebay_item_id: normalizeLegacyItemId(listing?.legacyItemId) || String(listing?.legacyItemId || ''),
                                item_title: listing?.item_title || null,
                                current_price_value: listing?.current_price_value ?? null,
                                current_price_currency: listing?.current_price_currency || null,
                                primary_image_url: listing?.primary_image_url || null,
                            });
                            for (const candidate of collectLegacyItemIdCandidates(listing?.legacyItemId)) {
                                missingSet.delete(candidate);
                            }
                        }
                    }
                    if (missingSet.size === 0) break;
                    if (!pageData?.hasMoreItems) break;
                }

                // Fallback: fetch each unresolved listing detail directly via Trading GetItem.
                const unresolved = Array.from(missingSet).slice(0, Math.max(1, SEND_OFFER_DETAIL_BACKFILL_MAX));
                const getTextValue = (value) => {
                    if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, '_')) {
                        return value._;
                    }
                    return value ?? null;
                };
                for (const unresolvedId of unresolved) {
                    const legacyItemId = normalizeLegacyItemId(unresolvedId);
                    if (!legacyItemId) continue;
                    try {
                        const detail = await fetchItemDetails(legacyItemId, tradingToken);
                        const currentPrice = detail?.StartPrice || detail?.SellingStatus?.CurrentPrice;
                        const primaryImage = Array.isArray(detail?.PictureDetails?.PictureURL)
                            ? detail.PictureDetails.PictureURL[0]
                            : detail?.PictureDetails?.PictureURL;
                        const payload = {
                            item_title: getTextValue(detail?.Title),
                            current_price_value: getTextValue(currentPrice),
                            current_price_currency: currentPrice?.$?.currencyID || null,
                            primary_image_url: primaryImage || null,
                            category_id: getTextValue(detail?.PrimaryCategory?.CategoryID),
                            category_name: getTextValue(detail?.PrimaryCategory?.CategoryName),
                            view_item_url: getTextValue(detail?.ListingDetails?.ViewItemURL) || getTextValue(detail?.ListingDetails?.ViewItemURLForNaturalSearch),
                            listing_date_utc: normalizeEbayDateTime(detail?.ListingDetails?.StartTime || detail?.StartTime),
                            listing_date_jst: convertIsoToJstTimestamp(detail?.ListingDetails?.StartTime || detail?.StartTime),
                            updated_at: new Date().toISOString(),
                        };
                        const { data: updatedRows, error: updateError } = await supabase
                            .from('items')
                            .update(payload)
                            .eq('user_id', account.user_id)
                            .eq('ebay_item_id', legacyItemId)
                            .select('ebay_item_id');
                        if (updateError) {
                            throw updateError;
                        }

                        // If no existing row matched, create one for this account.
                        if (!updatedRows || updatedRows.length === 0) {
                            const upsertPayload = {
                                ebay_item_id: legacyItemId,
                                user_id: account.user_id,
                                ebay_user_id: account.ebay_user_id,
                                ...payload,
                            };
                            const { error: insertError } = await supabase
                                .from('items')
                                .upsert(upsertPayload, { onConflict: 'ebay_item_id,ebay_user_id' });
                            if (insertError) {
                                throw insertError;
                            }
                        }
                        setItemMapRow(unresolvedId, {
                            ebay_item_id: legacyItemId,
                            item_title: payload.item_title,
                            current_price_value: payload.current_price_value,
                            current_price_currency: payload.current_price_currency,
                            primary_image_url: payload.primary_image_url,
                        });
                        filledByGetItem += 1;
                        for (const candidate of collectLegacyItemIdCandidates(unresolvedId)) {
                            missingSet.delete(candidate);
                        }
                    } catch (detailError) {
                        console.warn('[marketing] GetItem detail backfill failed', {
                            accountId,
                            legacyItemId,
                            message: detailError.message,
                        });
                    }
                }
            } catch (backfillError) {
                console.warn('[marketing] send-offer backfill failed', {
                    accountId,
                    message: backfillError.message,
                });
            }

            // Re-enrich after backfill attempt.
            await enrichFromDb();
            backfillStats = {
                requestedBackfillCount: missingIds.length,
                unresolvedAfterBackfill: uniqueItemIds.filter((id) => !hasUsableItemData(itemMap[id])).length,
                scannedPages,
                foundInEbay,
                filledByGetItem,
            };
        }

        const merged = eligibleItems.map((item) => {
            const lookupId = String(item?.itemId || item?.listingId || '');
            const db = (itemIdCandidatesByLookupId[lookupId] || []).map((candidate) => itemMap[candidate]).find(Boolean) || null;
            const hasApiPrice = item?.currentPrice?.value !== undefined && item?.currentPrice?.value !== null;
            return {
                ...item,
                title: item?.title || db?.item_title || null,
                imageUrl: item?.imageUrl || db?.primary_image_url || null,
                // Some accounts return only itemId; fallback listingId=itemId for selection key.
                listingId: item?.listingId || item?.itemId || null,
                currentPrice: hasApiPrice
                    ? item.currentPrice
                    : (db?.current_price_value !== null && db?.current_price_value !== undefined)
                        ? {
                            value: String(db.current_price_value),
                            currency: db.current_price_currency || 'USD',
                        }
                        : item?.currentPrice || null,
            };
        });

        return {
            ...data,
            eligibleItemSummaries: merged,
            enrichment: {
                requested: uniqueItemIds.length,
                resolved: uniqueItemIds.filter((id) => hasUsableItemData(itemMap[id])).length,
                unresolved: uniqueItemIds.filter((id) => !hasUsableItemData(itemMap[id])).length,
                backfill: backfillStats,
            },
        };
    } catch (err) {
        const status = err?.response?.status;
        const responseData = err?.response?.data;
        const message = responseData?.error || err.message || 'Failed to fetch eligible items';
        const error = new Error(message);
        error.status = status;
        error.responseData = responseData;
        throw error;
    }
}

const toFiniteNumber = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return numeric;
};

const getAccountAccess = async (accountId) => {
    if (!accountId) {
        throw new Error('accountId is required');
    }
    const account = await getAccountById(accountId);
    if (!account) {
        throw new Error('Account not found');
    }
    if (!account.refresh_token) {
        throw new Error('Account does not have a refresh token');
    }
    const accessToken = await refreshEbayToken(account.refresh_token);
    const marketplaceId = account.marketplace_id || process.env.EBAY_MARKETPLACE_ID || 'EBAY_US';
    return { account, accessToken, marketplaceId };
};

const normalizeIsoDate = (value, isEndDate = false) => {
    if (!value) return null;
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return isEndDate ? `${trimmed}T23:59:59.000Z` : `${trimmed}T00:00:00.000Z`;
    }
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
};

const normalizeMarkdownPresetPayload = (input = {}) => {
    const title = String(input.title || '').trim();
    if (!title) {
        throw new Error('title is required');
    }

    const discountPercent = toFiniteNumber(input.discountPercent);
    if (discountPercent === null || discountPercent <= 0 || discountPercent >= 100) {
        throw new Error('discountPercent must be between 0 and 100');
    }

    const categoryIds = Array.from(new Set(
        (Array.isArray(input.categoryIds) ? input.categoryIds : [])
            .map((id) => String(id || '').trim())
            .filter(Boolean)
    ));
    const priceMin = toFiniteNumber(input.priceMin);
    const priceMax = toFiniteNumber(input.priceMax);
    if (priceMin !== null && priceMax !== null && priceMin > priceMax) {
        throw new Error('priceMin must be less than or equal to priceMax');
    }

    return {
        title,
        discount_percent: discountPercent,
        category_ids: categoryIds,
        excluded_listing_ids: Array.from(new Set(
            (Array.isArray(input.excludedListingIds) ? input.excludedListingIds : [])
                .map((id) => String(id || '').trim())
                .filter(Boolean)
        )),
        price_min: priceMin,
        price_max: priceMax,
        description: String(input.description || '').trim() || null,
        is_active: input.isActive === undefined ? true : Boolean(input.isActive),
    };
};

async function listMarkdownPresets(accountId) {
    if (!accountId) {
        throw new Error('accountId is required');
    }

    const { data, error } = await supabase
        .from('markdown_presets')
        .select('*')
        .eq('account_id', accountId)
        .order('updated_at', { ascending: false });

    if (error) {
        throw new Error(`Failed to fetch markdown presets: ${error.message}`);
    }

    return data || [];
}

async function createMarkdownPreset(payload) {
    if (!payload?.accountId) {
        throw new Error('accountId is required');
    }
    await getAccountAccess(payload.accountId);
    const normalized = normalizeMarkdownPresetPayload(payload);
    const { data, error } = await supabase
        .from('markdown_presets')
        .insert({
            account_id: payload.accountId,
            ...normalized,
        })
        .select('*')
        .single();

    if (error) {
        throw new Error(`Failed to create markdown preset: ${error.message}`);
    }

    return data;
}

async function updateMarkdownPreset(presetId, payload) {
    if (!presetId) {
        throw new Error('presetId is required');
    }

    const { data: existing, error: existingError } = await supabase
        .from('markdown_presets')
        .select('*')
        .eq('id', presetId)
        .single();
    if (existingError || !existing) {
        throw new Error('Markdown preset not found');
    }

    await getAccountAccess(existing.account_id);
    const normalized = normalizeMarkdownPresetPayload({
        title: payload.title ?? existing.title,
        discountPercent: payload.discountPercent ?? existing.discount_percent,
        categoryIds: payload.categoryIds ?? existing.category_ids,
        excludedListingIds: payload.excludedListingIds ?? existing.excluded_listing_ids,
        priceMin: payload.priceMin ?? existing.price_min,
        priceMax: payload.priceMax ?? existing.price_max,
        description: payload.description ?? existing.description,
        isActive: payload.isActive ?? existing.is_active,
    });

    const { data, error } = await supabase
        .from('markdown_presets')
        .update(normalized)
        .eq('id', presetId)
        .select('*')
        .single();

    if (error) {
        throw new Error(`Failed to update markdown preset: ${error.message}`);
    }

    return data;
}

async function deleteMarkdownPreset(presetId) {
    if (!presetId) {
        throw new Error('presetId is required');
    }
    const { error } = await supabase
        .from('markdown_presets')
        .delete()
        .eq('id', presetId);
    if (error) {
        throw new Error(`Failed to delete markdown preset: ${error.message}`);
    }
    return { success: true };
}

async function getMarkdownPresetsByIds(presetIds = []) {
    const normalizedIds = Array.from(new Set(
        (presetIds || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
    ));
    if (normalizedIds.length === 0) {
        throw new Error('presetIds is required');
    }

    const { data, error } = await supabase
        .from('markdown_presets')
        .select('*')
        .in('id', normalizedIds);
    if (error) {
        throw new Error(`Failed to fetch markdown presets: ${error.message}`);
    }
    if (!data || data.length === 0) {
        throw new Error('No markdown presets found');
    }
    return data;
}

async function resolveMarkdownListingsForPreset(preset) {
    const { account } = await getAccountAccess(preset.account_id);
    let query = supabase
        .from('items')
        .select('ebay_item_id, category_id, category_name, current_price_value, current_price_currency, item_title, primary_image_url')
        .eq('user_id', account.user_id)
        .eq('ebay_user_id', account.ebay_user_id)
        .eq('listing_status', 'ACTIVE')
        .not('ebay_item_id', 'is', null);

    const categoryIds = Array.isArray(preset.category_ids)
        ? preset.category_ids.map((id) => String(id || '').trim()).filter(Boolean)
        : [];
    if (categoryIds.length > 0) {
        query = query.in('category_id', categoryIds);
    }
    if (preset.price_min !== null && preset.price_min !== undefined) {
        query = query.gte('current_price_value', preset.price_min);
    }
    if (preset.price_max !== null && preset.price_max !== undefined) {
        query = query.lte('current_price_value', preset.price_max);
    }

    const { data: listings, error } = await query.limit(2000);
    if (error) {
        throw new Error(`Failed to fetch listing candidates: ${error.message}`);
    }

    const excludedSet = new Set(
        (Array.isArray(preset.excluded_listing_ids) ? preset.excluded_listing_ids : [])
            .map((id) => String(id || '').trim())
            .filter(Boolean)
    );
    const normalizedListings = (listings || [])
        .map((row) => ({
            listingId: String(row.ebay_item_id || '').trim(),
            title: row.item_title || null,
            categoryId: row.category_id || null,
            categoryName: row.category_name || null,
            currentPrice: row.current_price_value ?? null,
            currency: row.current_price_currency || 'USD',
            imageUrl: row.primary_image_url || null,
            excluded: excludedSet.has(String(row.ebay_item_id || '').trim()),
        }))
        .filter((row) => row.listingId);
    const listingIds = normalizedListings
        .filter((row) => !row.excluded)
        .map((row) => row.listingId);
    return {
        account,
        listings: normalizedListings,
        listingIds,
        listingCount: listingIds.length,
        totalCandidateCount: normalizedListings.length,
        excludedCount: normalizedListings.filter((row) => row.excluded).length,
    };
}

async function previewMarkdownPresets({ presetIds = [] }) {
    let presets;
    if (Array.isArray(presetIds) && presetIds.length > 0) {
        presets = await getMarkdownPresetsByIds(presetIds);
    } else {
        presets = [{
            account_id: arguments[0]?.accountId,
            ...normalizeMarkdownPresetPayload({
                title: arguments[0]?.title || 'Preview',
                discountPercent: arguments[0]?.discountPercent,
                categoryIds: arguments[0]?.categoryIds,
                excludedListingIds: arguments[0]?.excludedListingIds,
                priceMin: arguments[0]?.priceMin,
                priceMax: arguments[0]?.priceMax,
                description: arguments[0]?.description,
                isActive: true,
            }),
            id: 'preview',
        }];
    }
    const results = [];

    for (const preset of presets) {
        const { listingCount, totalCandidateCount, excludedCount, listings } = await resolveMarkdownListingsForPreset(preset);
        results.push({
            presetId: preset.id,
            accountId: preset.account_id,
            title: preset.title,
            discountPercent: preset.discount_percent,
            listingCount,
            totalCandidateCount,
            excludedCount,
            isActive: preset.is_active,
            listings,
        });
    }

    return {
        results,
        totalListingCount: results.reduce((sum, row) => sum + (row.listingCount || 0), 0),
    };
}

async function createMarkdownSaleEventFromPreset({
    preset,
    startDate,
    endDate,
}) {
    const normalizedStart = normalizeIsoDate(startDate, false);
    const normalizedEnd = normalizeIsoDate(endDate, true);
    if (!normalizedStart || !normalizedEnd) {
        throw new Error('startDate and endDate are required (YYYY-MM-DD)');
    }

    const { accessToken, marketplaceId } = await getAccountAccess(preset.account_id);
    const { listingIds, totalCandidateCount, excludedCount } = await resolveMarkdownListingsForPreset(preset);
    if (listingIds.length === 0) {
        throw new Error('No active listings match filters');
    }

    const payload = {
        name: `${preset.title} ${String(startDate).trim()}`,
        description: String(preset.description || `Markdown ${preset.discount_percent}%`),
        startDate: normalizedStart,
        endDate: normalizedEnd,
        marketplaceId,
        promotionStatus: 'SCHEDULED',
        selectedInventoryDiscounts: [{
            inventoryCriterion: {
                inventoryCriterionType: 'INVENTORY_BY_VALUE',
                listingIds,
            },
            discountBenefit: {
                percentageOffItem: String(preset.discount_percent),
            },
        }],
    };

    const response = await axios.post(`${EBAY_MARKETING_API_BASE}/item_price_markdown`, payload, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
    });
    const location = response?.headers?.location || null;
    const promotionId = location ? String(location).split('/').pop() : null;

    return {
        promotionId,
        location,
        listingCount: listingIds.length,
        totalCandidateCount,
        excludedCount,
        marketplaceId,
        payload,
        responseData: response?.data || null,
    };
}

async function recordMarkdownRun(run) {
    const { error } = await supabase
        .from('markdown_runs')
        .insert(run);
    if (error) {
        console.warn('[marketing] failed to insert markdown run', { message: error.message });
    }
}

async function executeMarkdownPresets({ presetIds = [], startDate, endDate }) {
    const presets = await getMarkdownPresetsByIds(presetIds);
    const results = [];

    for (const preset of presets) {
        try {
            const result = await createMarkdownSaleEventFromPreset({ preset, startDate, endDate });
            await recordMarkdownRun({
                preset_id: preset.id,
                account_id: preset.account_id,
                status: 'success',
                promotion_id: result.promotionId,
                listing_count: result.listingCount,
                request_payload: result.payload,
                response_payload: {
                    location: result.location,
                    data: result.responseData,
                },
                error_message: null,
            });
            results.push({
                presetId: preset.id,
                accountId: preset.account_id,
                title: preset.title,
                status: 'success',
                promotionId: result.promotionId,
                listingCount: result.listingCount,
                totalCandidateCount: result.totalCandidateCount,
                excludedCount: result.excludedCount,
            });
        } catch (error) {
            await recordMarkdownRun({
                preset_id: preset.id,
                account_id: preset.account_id,
                status: 'failed',
                promotion_id: null,
                listing_count: 0,
                request_payload: {
                    startDate,
                    endDate,
                },
                response_payload: error.responseData || null,
                error_message: error.message || 'Failed to execute markdown preset',
            });
            results.push({
                presetId: preset.id,
                accountId: preset.account_id,
                title: preset.title,
                status: 'failed',
                error: error.message || 'Failed to execute markdown preset',
            });
        }
    }

    return {
        results,
        successCount: results.filter((row) => row.status === 'success').length,
        failureCount: results.filter((row) => row.status === 'failed').length,
    };
}

async function fetchEligibleItemsAll({ accessToken, marketplaceId, maxItems = 1000 }) {
    const items = [];
    let offset = 0;
    const limit = 200;
    while (items.length < maxItems) {
        const { data } = await axios.get(`${NEGOTIATION_API_BASE}/find_eligible_items`, {
            params: { limit, offset },
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'X-EBAY-C-MARKETPLACE-ID': marketplaceId,
                'Accept-Language': 'en-US',
            },
        });
        const pageItems = data?.eligibleItemSummaries || data?.eligibleItems || data?.items || [];
        items.push(...pageItems);
        if (pageItems.length < limit) break;
        offset += limit;
    }
    return items.slice(0, maxItems);
}

function filterItemsByPrice(items, minPrice = null, maxPrice = null) {
    const min = toFiniteNumber(minPrice);
    const max = toFiniteNumber(maxPrice);
    return (items || []).filter((item) => {
        const price = toFiniteNumber(item?.currentPrice?.value);
        if (price === null) {
            return min === null && max === null;
        }
        if (min !== null && price < min) return false;
        if (max !== null && price > max) return false;
        return true;
    });
}

const getOfferItemIdentifier = (item) => String(item?.listingId || item?.itemId || '').trim();

async function sendOfferToInterestedBuyers({
    accountId,
    discountType,
    discountValue,
    message = '',
    minPrice = null,
    maxPrice = null,
    listingIds = [],
}) {
    const normalizedType = String(discountType || '').trim().toLowerCase();
    const numericDiscount = toFiniteNumber(discountValue);
    if (!['rate', 'amount'].includes(normalizedType)) {
        throw new Error('discountType must be "rate" or "amount"');
    }
    if (numericDiscount === null || numericDiscount <= 0) {
        throw new Error('discountValue must be a positive number');
    }
    if (normalizedType === 'rate' && numericDiscount >= 100) {
        throw new Error('discountValue for rate must be < 100');
    }

    const { accessToken, marketplaceId } = await getAccountAccess(accountId);
    const eligibleItems = await fetchEligibleItemsAll({ accessToken, marketplaceId, maxItems: 1000 });
    const byPrice = filterItemsByPrice(eligibleItems, minPrice, maxPrice);
    const listingFilterSet = new Set((listingIds || []).map((id) => String(id)));
    const targetItems = listingFilterSet.size > 0
        ? byPrice.filter((item) => listingFilterSet.has(getOfferItemIdentifier(item)))
        : byPrice;

    console.info('[marketing] sendOfferToInterestedBuyers start', {
        accountId,
        marketplaceId,
        discountType: normalizedType,
        discountValue: numericDiscount,
        requestedListingIds: Array.from(listingFilterSet),
        scannedEligibleCount: eligibleItems.length,
        filteredEligibleCount: byPrice.length,
        targetCount: targetItems.length,
        targetIdentifiers: targetItems.map((item) => getOfferItemIdentifier(item)),
    });

    const results = [];
    for (const item of targetItems) {
        const listingId = getOfferItemIdentifier(item);
        if (!listingId) {
            results.push({ listingId: null, success: false, error: 'Listing ID / Item ID not found' });
            continue;
        }
        const payload = {
            allowCounterOffer: false,
            message: String(message || '').slice(0, 2000),
            offeredItems: [{
                listingId,
                quantity: 1,
            }],
        };
        if (normalizedType === 'rate') {
            payload.offeredItems[0].discountPercentage = String(numericDiscount);
        } else {
            const current = toFiniteNumber(item?.currentPrice?.value);
            const currency = item?.currentPrice?.currency || 'USD';
            if (current === null) {
                results.push({ listingId, success: false, error: 'Current price not found' });
                continue;
            }
            const offered = Math.max(0.01, current - numericDiscount);
            payload.offeredItems[0].price = {
                value: offered.toFixed(2),
                currency,
            };
        }

        try {
            console.info('[marketing] send_offer_to_interested_buyers request', {
                accountId,
                marketplaceId,
                listingId,
                payload,
            });
            const { data } = await axios.post(`${NEGOTIATION_API_BASE}/send_offer_to_interested_buyers`, payload, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'X-EBAY-C-MARKETPLACE-ID': marketplaceId,
                    'Accept-Language': 'en-US',
                },
            });
            console.info('[marketing] send_offer_to_interested_buyers response', {
                accountId,
                marketplaceId,
                listingId,
                response: data || null,
            });
            results.push({
                listingId,
                success: true,
                data: data || null,
            });
        } catch (err) {
            console.warn('[marketing] send_offer_to_interested_buyers error', {
                accountId,
                marketplaceId,
                listingId,
                status: err?.response?.status || null,
                response: err?.response?.data || null,
                message: err.message,
            });
            results.push({
                listingId,
                success: false,
                error: err?.response?.data?.errors || err?.response?.data?.error || err.message || 'Failed to send offer',
            });
        }
    }

    const successCount = results.filter((row) => row.success).length;
    console.info('[marketing] sendOfferToInterestedBuyers summary', {
        accountId,
        marketplaceId,
        successCount,
        failureCount: results.length - successCount,
        results,
    });
    return {
        scannedEligibleCount: eligibleItems.length,
        filteredEligibleCount: byPrice.length,
        targetCount: targetItems.length,
        successCount,
        failureCount: results.length - successCount,
        results,
    };
}

const normalizeBidPercentage = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    const rounded = Math.round(numeric * 10) / 10;
    if (rounded < 2 || rounded > 100) return null;
    return rounded.toFixed(1);
};

const fetchActiveListingIds = async (userId, ebayUserId) => {
    const ids = [];
    const pageSize = 1000;
    let lastItemId = null;

    for (let page = 0; page < 200; page += 1) {
        let query = supabase
            .from('items')
            .select('ebay_item_id')
            .eq('user_id', userId)
            .eq('ebay_user_id', ebayUserId)
            .eq('listing_status', 'ACTIVE')
            .not('ebay_item_id', 'is', null)
            .order('ebay_item_id', { ascending: true })
            .limit(pageSize);

        if (lastItemId !== null) {
            query = query.gt('ebay_item_id', lastItemId);
        }

        const { data, error } = await query;
        if (error) {
            throw new Error(`Failed to fetch active listings: ${error.message}`);
        }

        const pageIds = (data || []).map((item) => item.ebay_item_id).filter(Boolean);
        ids.push(...pageIds);

        if (pageIds.length < pageSize) {
            break;
        }

        lastItemId = pageIds[pageIds.length - 1];
    }

    return ids;
};

const createPromotedCampaign = async (accessToken, marketplaceId, campaignName, bidPercentage, endDate = null) => {
    const payload = {
        campaignName,
        startDate: new Date().toISOString(),
        fundingStrategy: {
            bidPercentage,
            fundingModel: 'COST_PER_SALE',
        },
        marketplaceId,
    };
    if (endDate) {
        payload.endDate = endDate;
    }
    const response = await axios.post(`${EBAY_MARKETING_API_BASE}/ad_campaign`, payload, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
    });
    const location = response?.headers?.location || '';
    const campaignId = location.split('/').pop() || null;
    if (!campaignId) {
        throw new Error('Campaign ID not found in response');
    }
    return campaignId;
};

const bulkCreateAdsByListingId = async (accessToken, campaignId, listingIds, bidPercentage) => {
    const payload = {
        requests: listingIds.map((listingId) => ({
            listingId: String(listingId),
            bidPercentage,
        })),
    };
    const response = await axios.post(
        `${EBAY_MARKETING_API_BASE}/ad_campaign/${campaignId}/bulk_create_ads_by_listing_id`,
        payload,
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        }
    );
    return response.data || {};
};

const normalizeEndDate = (value) => {
    return normalizeIsoDate(value, true);
};

async function getMarkdownCategoryCandidates(accountId, { limit = 200 } = {}) {
    const { account } = await getAccountAccess(accountId);
    const { data, error } = await supabase
        .from('items')
        .select('category_id')
        .eq('user_id', account.user_id)
        .eq('ebay_user_id', account.ebay_user_id)
        .eq('listing_status', 'ACTIVE')
        .not('category_id', 'is', null)
        .limit(Math.min(Math.max(Number(limit) || 0, 1), 1000));
    if (error) {
        throw new Error(`Failed to fetch categories: ${error.message}`);
    }
    const counts = new Map();
    for (const row of data || []) {
        const categoryId = String(row.category_id || '').trim();
        if (!categoryId) continue;
        counts.set(categoryId, (counts.get(categoryId) || 0) + 1);
    }
    return Array.from(counts.entries())
        .map(([categoryId, itemCount]) => ({ categoryId, itemCount }))
        .sort((a, b) => b.itemCount - a.itemCount);
}

async function createMarkdownSaleEvent({
    accountId,
    discountPercent,
    startDate,
    endDate,
    categoryIds = [],
    minPrice = null,
    maxPrice = null,
    name = '',
    description = '',
}) {
    const preset = {
        account_id: accountId,
        title: String(name || `Markdown ${new Date().toISOString().slice(0, 10)}`),
        discount_percent: discountPercent,
        category_ids: categoryIds,
        excluded_listing_ids: [],
        price_min: minPrice,
        price_max: maxPrice,
        description,
    };
    const normalizedPreset = normalizeMarkdownPresetPayload({
        title: preset.title,
        discountPercent: preset.discount_percent,
        categoryIds: preset.category_ids,
        excludedListingIds: preset.excluded_listing_ids,
        priceMin: preset.price_min,
        priceMax: preset.price_max,
        description: preset.description,
        isActive: true,
    });
    const result = await createMarkdownSaleEventFromPreset({
        preset: {
            ...preset,
            ...normalizedPreset,
        },
        startDate,
        endDate,
    });
    return {
        promotionId: result.promotionId,
        location: result.location,
        listingCount: result.listingCount,
        marketplaceId: result.marketplaceId,
    };
}

async function bulkApplyPromotedListings({ accountIds = [], bidPercentage, endDate = null }) {
    if (!Array.isArray(accountIds) || accountIds.length === 0) {
        throw new Error('accountIds is required');
    }
    const normalizedBid = normalizeBidPercentage(bidPercentage);
    if (!normalizedBid) {
        throw new Error('bidPercentage must be between 2.0 and 100.0');
    }
    const normalizedEndDate = normalizeEndDate(endDate);
    if (endDate && !normalizedEndDate) {
        throw new Error('endDate must be a valid date (YYYY-MM-DD)');
    }

    const processAccount = async (accountId) => {
        try {
            const account = await getAccountById(accountId);
            if (!account) {
                throw new Error('Account not found');
            }
            if (!account.refresh_token) {
                throw new Error('Account does not have a refresh token');
            }
            const accessToken = await refreshEbayToken(account.refresh_token);
            const marketplaceId = account.marketplace_id || process.env.EBAY_MARKETPLACE_ID || 'EBAY_US';
            const campaignName = `Auto Promoted ${new Date().toISOString().slice(0, 10)} ${account.ebay_user_id || account.id}`;

            const listingIds = await fetchActiveListingIds(account.user_id, account.ebay_user_id);
            if (listingIds.length === 0) {
                return {
                    accountId,
                    ebay_user_id: account.ebay_user_id,
                    campaignId: null,
                    createdAds: 0,
                    message: 'No active listings found',
                };
            }

            const campaignId = await createPromotedCampaign(
                accessToken,
                marketplaceId,
                campaignName,
                normalizedBid,
                normalizedEndDate
            );

            let createdAds = 0;
            for (let i = 0; i < listingIds.length; i += 500) {
                const chunk = listingIds.slice(i, i + 500);
                const bulkResponse = await bulkCreateAdsByListingId(accessToken, campaignId, chunk, normalizedBid);
                const successes = Array.isArray(bulkResponse?.responses)
                    ? bulkResponse.responses.filter((item) => item?.statusCode >= 200 && item?.statusCode < 300).length
                    : chunk.length;
                createdAds += successes;
            }

            return {
                accountId,
                ebay_user_id: account.ebay_user_id,
                campaignId,
                createdAds,
            };
        } catch (err) {
            return {
                accountId,
                error: err.message || 'Failed to apply promoted listings',
            };
        }
    };

    const results = [];
    for (let i = 0; i < accountIds.length; i += PRL_ACCOUNT_CONCURRENCY) {
        const chunk = accountIds.slice(i, i + PRL_ACCOUNT_CONCURRENCY);
        const chunkResults = await Promise.all(chunk.map((accountId) => processAccount(accountId)));
        results.push(...chunkResults);
    }

    const successCount = results.filter((row) => !row.error).length;
    const failureCount = results.length - successCount;

    return {
        results,
        successCount,
        failureCount,
    };
}

module.exports = {
    getSendOfferEligibleItems,
    sendOfferToInterestedBuyers,
    getMarkdownCategoryCandidates,
    listMarkdownPresets,
    createMarkdownPreset,
    updateMarkdownPreset,
    deleteMarkdownPreset,
    previewMarkdownPresets,
    executeMarkdownPresets,
    createMarkdownSaleEvent,
    bulkApplyPromotedListings,
};
