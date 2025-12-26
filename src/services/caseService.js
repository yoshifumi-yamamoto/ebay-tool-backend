const axios = require('axios');
const supabase = require('../supabaseClient');
const { fetchEbayAccountTokens, refreshEbayToken } = require('./accountService');

const POST_ORDER_BASE_URL = 'https://api.ebay.com/post-order/v2';

const authHeaders = (accessToken) => ({
  // Post-Order API expects TOKEN scheme (not Bearer)
  Authorization: `TOKEN ${accessToken}`,
  'Content-Type': 'application/json',
  'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
});

async function fetchReturnRequests(accessToken) {
  const url = `${POST_ORDER_BASE_URL}/return/search`;
  const { data } = await axios.get(url, { headers: authHeaders(accessToken) });
  return data?.returns || [];
}

async function fetchInquiries(accessToken) {
  const url = `${POST_ORDER_BASE_URL}/inquiry/search`;
  const { data } = await axios.get(url, { headers: authHeaders(accessToken) });
  return data?.inquirySearchResult?.inquirySearchResponse || [];
}

function mapReturnToCaseRow(ret, accountId) {
  const refund = ret?.buyerTotal?.refundAmount || ret?.buyerTotal || {};
  const item = (ret?.returnItems || [])[0] || {};
  const openedAt = ret?.creationDate || ret?.creationDate?.value || ret?.creationDate?.date || null;
  const resolutionDue = ret?.responseDue || ret?.buyerEscalationEligibilityDate || null;

  return {
    ebay_case_id: String(ret.returnId?.id || ret.returnId || ''),
    case_type: 'RETURN',
    status: ret?.status || 'UNKNOWN',
    account_id: accountId,
    order_id: null,
    buyer_id: null,
    reason: ret?.reason || item?.returnReason || null,
    requested_action: ret?.returnRequestType || ret?.returnRequest?.requestType || null,
    expected_refund: refund?.value ? Number(refund.value) : null,
    currency_code: refund?.currency || refund?.currencyId || null,
    memo: ret?.buyerNote || ret?.note || null,
    opened_at: openedAt,
    resolution_due_at: resolutionDue,
    last_responded_at: ret?.lastModifiedDate || null,
    return_tracking_number: ret?.trackingInfo?.trackingNumber || null,
    return_carrier: ret?.trackingInfo?.carrierUsed || null,
    updated_at: new Date().toISOString()
  };
}

function mapInquiryToCaseRow(inquiry, accountId) {
  const refund = inquiry?.claimAmount || {};
  const openedAt = inquiry?.openDate || inquiry?.creationDate || null;
  const resolutionDue = inquiry?.respondByDate || inquiry?.escalationEligibilityDate || null;

  return {
    ebay_case_id: String(inquiry.inquiryId?.id || inquiry.inquiryId || ''),
    case_type: 'INR',
    status: inquiry?.status || 'UNKNOWN',
    account_id: accountId,
    order_id: null,
    buyer_id: null,
    reason: inquiry?.inquiryReason || inquiry?.itemNotReceivedReason || null,
    requested_action: inquiry?.requestedAction || null,
    expected_refund: refund?.value ? Number(refund.value) : null,
    currency_code: refund?.currency || refund?.currencyId || null,
    memo: inquiry?.buyerInitialMessage || inquiry?.message || null,
    opened_at: openedAt,
    resolution_due_at: resolutionDue,
    last_responded_at: inquiry?.lastUpdatedDate || null,
    return_tracking_number: null,
    return_carrier: null,
    updated_at: new Date().toISOString()
  };
}

async function upsertCaseRecords(rows) {
  if (!rows.length) return [];
  const { data, error } = await supabase
    .from('case_records')
    .upsert(rows, { onConflict: 'ebay_case_id' })
    .select();

  if (error) {
    console.error('Failed to upsert case records:', error.message);
    throw new Error('Failed to upsert case records');
  }
  return data || [];
}

async function syncCasesForUser(userId = 2) {
  const accounts = await fetchEbayAccountTokens(userId);
  if (!accounts || accounts.length === 0) {
    throw new Error('No eBay accounts found for user');
  }

  const allCases = [];

  for (const account of accounts) {
    const refreshToken = account.refresh_token;
    if (!refreshToken) continue;

    const accessToken = await refreshEbayToken(refreshToken);
    const [returns, inquiries] = await Promise.all([
      fetchReturnRequests(accessToken),
      fetchInquiries(accessToken)
    ]);

    const mappedReturns = returns
      .filter((r) => r?.returnId)
      .map((r) => mapReturnToCaseRow(r, account.id));
    const mappedInquiries = inquiries
      .filter((inq) => inq?.inquiryId)
      .map((inq) => mapInquiryToCaseRow(inq, account.id));

    allCases.push(...mappedReturns, ...mappedInquiries);
  }

  await upsertCaseRecords(allCases);
  return allCases;
}

module.exports = {
  syncCasesForUser,
  fetchReturnRequests,
  fetchInquiries,
};
