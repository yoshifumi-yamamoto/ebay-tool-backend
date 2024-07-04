const supabase = require('../supabaseClient');
const { Parser } = require('json2csv');

exports.fetchListingsSummary = async (filters) => {
  const { start_date, end_date } = filters;

  // itemsテーブルからデータを取得
  let itemsQuery = supabase
    .from('items')
    .select('exhibit_date, research_date, researcher, exhibitor')
    .or(`exhibit_date.gte.${start_date},exhibit_date.lte.${end_date}`)
    .or(`research_date.gte.${start_date},research_date.lte.${end_date}`);

  const { data: itemsData, error: itemsError } = await itemsQuery;
  if (itemsError) {
    console.error('Error fetching items data:', itemsError.message);
    throw itemsError;
  }

  // ordersテーブルからデータを取得
  let ordersQuery = supabase
    .from('orders')
    .select('order_date, researcher')
    .gte('order_date', start_date)
    .lte('order_date', end_date);

  const { data: ordersData, error: ordersError } = await ordersQuery;
  if (ordersError) {
    console.error('Error fetching orders data:', ordersError.message);
    throw ordersError;
  }

  // 出品件数とリサーチ件数を集計
  const listingsSummary = itemsData.reduce((acc, item) => {
    const { researcher, exhibitor, exhibit_date, research_date } = item;

    if (exhibit_date && exhibit_date >= start_date && exhibit_date <= end_date) {
      if (!acc[exhibitor]) acc[exhibitor] = { exhibitCount: 0, researchCount: 0, salesCount: 0 };
      acc[exhibitor].exhibitCount++;
    }

    if (research_date && research_date >= start_date && research_date <= end_date) {
      if (!acc[researcher]) acc[researcher] = { exhibitCount: 0, researchCount: 0, salesCount: 0 };
      acc[researcher].researchCount++;
    }

    return acc;
  }, {});

  // 販売件数を集計
  ordersData.forEach(order => {
    const { researcher } = order;
    if (!listingsSummary[researcher]) {
      listingsSummary[researcher] = { exhibitCount: 0, researchCount: 0, salesCount: 0 };
    }
    listingsSummary[researcher].salesCount++;
  });

  return { listingsSummary };
};

// CSVダウンロード機能
exports.downloadListingsSummaryCSV = async (filters) => {
  const { listingsSummary } = await this.fetchListingsSummary(filters);

  // データの整形
  const csvData = Object.keys(listingsSummary).map(researcher => ({
    researcher,
    exhibitCount: listingsSummary[researcher].exhibitCount || 0,
    researchCount: listingsSummary[researcher].researchCount || 0,
    salesCount: listingsSummary[researcher].salesCount || 0
  }));

  const csvFields = [
    { label: 'Researcher', value: 'researcher' },
    { label: 'Exhibit Count', value: 'exhibitCount' },
    { label: 'Research Count', value: 'researchCount' },
    { label: 'Sales Count', value: 'salesCount' }
  ];

  const csvParser = new Parser({ fields: csvFields });
  const csv = csvParser.parse(csvData);

  return csv;
};
