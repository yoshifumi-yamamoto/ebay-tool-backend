const express = require('express');
const { getAllOctoparseData, updateInventoryManagementFlag, deleteOctoparseData, updateTaskDeleteFlag } = require('../controllers/octoparseController');
const router = express.Router();

// octoparse_tasksテーブルのデータ
router.get('/fetch-all-data', getAllOctoparseData);
// 在庫管理フラグを更新するエンドポイント
router.put('/inventory-management', updateInventoryManagementFlag);
// octoparseのタスクのデータを削除するエンドポイント
router.post('/delete-data', deleteOctoparseData);
// task_delete_flgを更新するエンドポイント
router.put('/update-task-delete-flag', updateTaskDeleteFlag);

module.exports = router;
