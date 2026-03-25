const express = require('express');
const { getItems, getItemsSimple, getSupplierCandidates } = require('../controllers/itemSearchController');

const router = express.Router();

// `POST`リクエストを使用するようにルートを変更
router.post('/search', getItems);
router.get('/simple', getItemsSimple);
router.get('/supplier-candidates', getSupplierCandidates);

module.exports = router;
