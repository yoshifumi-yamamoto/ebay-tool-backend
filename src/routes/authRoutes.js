const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// eBay認証URLを取得するエンドポイント
router.get('/ebay-auth-url', authController.getEbayAuthUrl);

// eBayからの認証コードを受け取り、トークンを取得するエンドポイント
router.post('/ebay-token', authController.getEbayToken);

// eBayからのリダイレクトを受け取るエンドポイント
router.get('/ebay-callback', authController.handleEbayCallback);

module.exports = router;
