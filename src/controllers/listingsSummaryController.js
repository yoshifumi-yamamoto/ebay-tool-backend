const { fetchListingsSummary, downloadListingsSummaryCSV } = require('../services/listingsSummaryService');

exports.getListingsSummary = async (req, res) => {
  const { start_date, end_date, user_id } = req.query;

  try {
    const summary = await fetchListingsSummary({ start_date, end_date, user_id });
    res.status(200).json(summary);
  } catch (error) {
    console.error('Error fetching listing summary:', error.message);
    res.status(500).json({ message: 'Failed to fetch listing summary' });
  }
};

exports.downloadListingsSummaryCSV = async (req, res) => {
  const { start_date, end_date, user_id } = req.query;

  try {
    const csv = await downloadListingsSummaryCSV({ start_date, end_date, user_id });
    res.header('Content-Type', 'text/csv');
    res.attachment(`listings_summary_${start_date}_to_${end_date}.csv`);
    res.send(csv);
  } catch (error) {
    console.error('Error downloading listings summary CSV:', error.message);
    res.status(500).json({ message: 'Failed to download listings summary CSV' });
  }
};
