const express = require('express');
const { getItems } = require('../controllers/itemSearchController');

const router = express.Router();

// `POST`リクエストを使用するようにルートを変更
router.post('/search', getItems);

module.exports = router;
