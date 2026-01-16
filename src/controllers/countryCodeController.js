const { listCountryCodes } = require('../services/countryCodeService');

exports.getCountryCodes = async (req, res) => {
  try {
    const codes = await listCountryCodes();
    return res.status(200).json({ codes });
  } catch (error) {
    console.error('[countryCode] Failed to fetch country codes:', error.message);
    return res.status(500).json({ error: 'Failed to fetch country codes' });
  }
};
