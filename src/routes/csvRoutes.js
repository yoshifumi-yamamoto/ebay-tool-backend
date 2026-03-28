const express = require('express');
const multer = require('multer');
const csvController = require('../controllers/csvController');

const router = express.Router();

// メモリストレージを使用するための設定
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// ファイルアップロードのルート
router.post('/upload', upload.single('file'), (req, res, next) => {
  console.log('Received request body:', req.body);
  console.log('Received file:', req.file);
  next(); // 次のミドルウェアへ
}, csvController.processCSVUpload);

// ファイルアップロードのルート
router.post('/upload-acrive-listings', upload.single('file'), (req, res, next) => {
  console.log('Received request body:', req.body);
  console.log('Received file:', req.file);
  next(); // 次のミドルウェアへ
}, csvController.processActiveListingsCSVUpload);

router.post('/upload-shipping-costs', upload.single('file'), (req, res, next) => {
  console.log('Received request body:', req.body);
  console.log('Received file:', req.file);
  next();
}, csvController.processShippingCostsCSVUpload);

router.post('/upload-carrier-invoices', upload.array('files', 20), (req, res, next) => {
  console.log('Received request body:', req.body);
  console.log('Received files:', req.files);
  next();
}, csvController.processCarrierInvoicesCSVUpload);
router.post('/carrier-invoice-email', csvController.upsertCarrierInvoiceEmail);

router.get('/carrier-invoice-anomalies', csvController.getCarrierInvoiceAnomalies);
router.patch('/carrier-invoice-anomalies/:id/resolve', csvController.patchCarrierInvoiceAnomalyResolution);
router.get('/carrier-invoice-charge-details', csvController.getCarrierInvoiceChargeDetails);
router.get('/carrier-unknown-charge-events', csvController.getUnknownCarrierChargeEvents);


module.exports = router;
