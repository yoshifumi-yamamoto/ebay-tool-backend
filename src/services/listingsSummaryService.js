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

  const itemFields = 'exhibit_date, research_date, researcher, exhibitor, ebay_user_id';

  const exhibitQuery = supabase
    .from('items')
    .select(itemFields)
    .eq('user_id', user_id)
    .gte('exhibit_date', start_date)
    .lte('exhibit_date', end_date);

  const researchQuery = supabase
    .from('items')
    .select(itemFields)
    .eq('user_id', user_id)
    .gte('research_date', start_date)
    .lte('research_date', end_date);

  const [{ data: exhibitItems, error: exhibitError }, { data: researchItems, error: researchError }] =
    await Promise.all([exhibitQuery, researchQuery]);

  if (exhibitError || researchError) {
    const message = exhibitError?.message || researchError?.message || 'unknown error';
    console.error('Error fetching items data:', message);
    throw exhibitError || researchError;
  }

  // ordersテーブルからデータを取得
  let ordersQuery = supabase
    .from('orders')
    .select('order_date, researcher')
    .eq('user_id', user_id)
    .gte('order_date', start_date)
    .lte('order_date', end_date);

  const { data: ordersData, error: ordersError } = await ordersQuery;
  if (ordersError) {
    console.error('Error fetching orders data:', ordersError.message);
    throw ordersError;
  }

  // 出品件数とリサーチ件数を集計
  const listingsSummary = {};
  let totalExhibitCount = 0;
  const accountSummary = {};

  for (const item of exhibitItems || []) {
    const { exhibitor, ebay_user_id } = item;
    if (!listingsSummary[exhibitor]) {
      listingsSummary[exhibitor] = { exhibitCount: 0, researchCount: 0, salesCount: 0 };
    }
    listingsSummary[exhibitor].exhibitCount++;
    totalExhibitCount++;

    if (ebay_user_id) {
      if (!accountSummary[ebay_user_id]) accountSummary[ebay_user_id] = 0;
      accountSummary[ebay_user_id]++;
    }
  }

  for (const item of researchItems || []) {
    const { researcher } = item;
    if (!listingsSummary[researcher]) {
      listingsSummary[researcher] = { exhibitCount: 0, researchCount: 0, salesCount: 0 };
    }
    listingsSummary[researcher].researchCount++;
  }

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

  ordersData.forEach(order => {
    const { researcher } = order;
    if (!listingsSummary[researcher]) {
      listingsSummary[researcher] = { exhibitCount: 0, researchCount: 0, salesCount: 0 };
    }
    listingsSummary[researcher].salesCount++;
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
