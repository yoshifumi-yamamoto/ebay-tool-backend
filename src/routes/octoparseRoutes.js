const express = require('express');
const { getAllOctoparseData, updateInventoryManagementFlag } = require('../controllers/octoparseController');
const router = express.Router();

// octoparse_tasksテーブルのデータ
router.get('/fetch-all-data', getAllOctoparseData);
// 在庫管理フラグを更新するエンドポイント
router.put('/inventory-management', updateInventoryManagementFlag);

module.exports = router;
