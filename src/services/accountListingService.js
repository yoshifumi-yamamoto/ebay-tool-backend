const supabase = require('../supabaseClient');

exports.fetchAccountListings = async (filters) => {
  const { start_date, end_date, ebay_user_id, researcher, exhibitor } = filters;

  let query = supabase
    .from('items')
    .select('listing_date, researcher, exhibitor')
    .gte('listing_date', start_date)
    .lte('listing_date', end_date);

  if (ebay_user_id) query = query.eq('ebay_user_id', ebay_user_id);
  if (researcher) query = query.eq('researcher', researcher);
  if (exhibitor) query = query.eq('exhibitor', exhibitor);

  const { data, error } = await query;

  if (error) throw error;

  const totalListings = data.length;

  const researcherListings = data.reduce((acc, item) => {
    const { researcher } = item;
    if (researcher) {
      if (!acc[researcher]) acc[researcher] = 0;
      acc[researcher] += 1;
    }
    return acc;
  }, {});

  const exhibitorListings = data.reduce((acc, item) => {
    const { exhibitor } = item;
    if (exhibitor) {
      if (!acc[exhibitor]) acc[exhibitor] = 0;
      acc[exhibitor] += 1;
    }
    return acc;
  }, {});

  return {
    total_listings: totalListings,
    researcher_listings: researcherListings,
    exhibitor_listings: exhibitorListings,
  };
};
