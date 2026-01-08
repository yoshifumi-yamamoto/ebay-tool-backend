const express = require('express');
const { getItems, getItemsSimple } = require('../controllers/itemSearchController');

const router = express.Router();

// `POST`リクエストを使用するようにルートを変更
router.post('/search', getItems);
router.get('/simple', getItemsSimple);

module.exports = router;
