const express = require('express');
const multer = require('multer');
const csvController = require('../controllers/csvController');

const router = express.Router();

// メモリストレージを使用するための設定
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// ファイルアップロードのルート
router.post('/upload', upload.single('file'), csvController.uploadCSV);

module.exports = router;
