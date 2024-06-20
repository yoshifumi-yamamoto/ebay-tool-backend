const express = require('express');
const { getAllOctoparseData, updateInventoryManagementFlag, deleteOctoparseData } = require('../controllers/octoparseController');
const router = express.Router();

// octoparse_tasksテーブルのデータ
router.get('/fetch-all-data', getAllOctoparseData);
// 在庫管理フラグを更新するエンドポイント
router.put('/inventory-management', updateInventoryManagementFlag);
// octoparseのタスクのデータを削除するエンドポイント
router.post('/delete-data', deleteOctoparseData);

module.exports = router;
