const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/categoryController');

// カテゴリの同期ルート
router.get('/sync', categoryController.syncCategories);

// Supabaseからカテゴリを取得するルート
router.get('/', categoryController.getCategories);

// 親カテゴリに基づいて子カテゴリを取得するルート
router.get('/children/:parentCategoryId', categoryController.getChildCategories);

module.exports = router;
