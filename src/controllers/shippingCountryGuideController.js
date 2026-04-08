const {
  listShippingCountryGuides,
  updateShippingCountryGuide,
} = require('../services/shippingCountryGuideService');
const path = require('path');

const SOURCE_FILES = {
  fedex_interconnect_export: {
    path: path.resolve(__dirname, '../../../docs/shipping-country-db/sources/fedex/【ご提案】INTERCONNECT様　輸出料金表.pdf'),
    filename: 'fedex-interconnect-export-rate.pdf',
    contentType: 'application/pdf',
  },
  dhl_rate_table: {
    path: path.resolve(__dirname, '../../../docs/shipping-country-db/sources/dhl/2026 eBay料金表_DTU1_dhl.xlsx'),
    filename: 'dhl-rate-table.xlsx',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
};

exports.getShippingCountryGuides = async (req, res) => {
  try {
    const result = await listShippingCountryGuides(req.query || {});
    return res.status(200).json(result);
  } catch (error) {
    console.error('[shippingCountryGuide] Failed to fetch guides:', error.message);
    return res.status(500).json({ error: 'Failed to fetch shipping country guides' });
  }
};

exports.patchShippingCountryGuide = async (req, res) => {
  try {
    const guide = await updateShippingCountryGuide(req.params.countryNameJa, req.body || {});
    return res.status(200).json({ guide });
  } catch (error) {
    console.error('[shippingCountryGuide] Failed to update guide:', error.message);
    return res.status(500).json({ error: 'Failed to update shipping country guide' });
  }
};

exports.getShippingCountryGuideSourceFile = async (req, res) => {
  const source = SOURCE_FILES[req.params.sourceKey];
  if (!source) {
    return res.status(404).json({ error: 'Source file not found' });
  }

  res.setHeader('Content-Type', source.contentType);
  res.setHeader('Content-Disposition', `inline; filename="${source.filename}"`);
  return res.sendFile(source.path, (error) => {
    if (error) {
      console.error('[shippingCountryGuide] Failed to send source file:', error.message);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to open source file' });
      }
    }
  });
};
