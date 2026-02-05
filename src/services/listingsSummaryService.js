const supabase = require('../supabaseClient');
const { getAccountsByUserId } = require('./accountService');
const { Parser } = require('json2csv');

exports.fetchListingsSummary = async (filters) => {
  const { start_date, end_date, user_id } = filters;
  if (!user_id) {
    throw new Error('user_id is required');
  }
  if (!start_date || !end_date) {
    throw new Error('start_date and end_date are required');
  }

  const { data: summaryRows, error: summaryError } = await supabase.rpc(
    'listings_summary_counts',
    {
      p_user_id: user_id,
      p_start_date: start_date,
      p_end_date: end_date,
    }
  );

  if (summaryError) {
    console.error('Error fetching listing summary:', summaryError.message);
    throw summaryError;
  }

  const listingsSummary = {};
  let totalExhibitCount = 0;
  (summaryRows || []).forEach((row) => {
    const name = row.researcher || 'unknown';
    listingsSummary[name] = {
      exhibitCount: Number(row.exhibit_count) || 0,
      researchCount: Number(row.research_count) || 0,
      salesCount: Number(row.sales_count) || 0,
    };
    totalExhibitCount += Number(row.exhibit_count) || 0;
  });

  const { data: accountRows, error: accountError } = await supabase.rpc(
    'listings_summary_account_counts',
    {
      p_user_id: user_id,
      p_start_date: start_date,
      p_end_date: end_date,
    }
  );

  if (accountError) {
    console.error('Error fetching account summary:', accountError.message);
    throw accountError;
  }

  const accountSummary = (accountRows || []).reduce((acc, row) => {
    if (!row?.ebay_user_id) return acc;
    acc[row.ebay_user_id] = Number(row.exhibit_count) || 0;
    return acc;
  }, {});

  const accounts = await getAccountsByUserId(user_id);
  accounts.forEach((account) => {
    const ebayUserId = account?.ebay_user_id;
    if (!ebayUserId) {
      return;
    }
    if (!accountSummary[ebayUserId]) {
      accountSummary[ebayUserId] = 0;
    }
  });

  return { listingsSummary, totalExhibitCount, accountSummary };
};

// CSVダウンロード機能
exports.downloadListingsSummaryCSV = async (filters) => {
  const { listingsSummary, totalExhibitCount, accountSummary } = await this.fetchListingsSummary(filters);

  // データの整形
  const csvData = Object.keys(listingsSummary).map(researcher => ({
    researcher,
    exhibitCount: listingsSummary[researcher].exhibitCount || 0,
    researchCount: listingsSummary[researcher].researchCount || 0,
    salesCount: listingsSummary[researcher].salesCount || 0
  }));

  const accountSummaryRows = Object.entries(accountSummary).map(([account, count]) => ({
    researcher: account,
    exhibitCount: count,
    researchCount: '',
    salesCount: '',
  }));

  csvData.push({
    researcher: 'Total',
    exhibitCount: totalExhibitCount,
    researchCount: '',
    salesCount: '',
  });

  const csvFields = [
    { label: 'Researcher', value: 'researcher' },
    { label: 'Exhibit Count', value: 'exhibitCount' },
    { label: 'Research Count', value: 'researchCount' },
    { label: 'Sales Count', value: 'salesCount' }
  ];

  const csvParser = new Parser({ fields: csvFields });
  const csv = csvParser.parse([...csvData, ...accountSummaryRows]);

  return csv;
};
