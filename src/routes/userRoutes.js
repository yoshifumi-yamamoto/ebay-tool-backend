const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');

// 特定のユーザーの情報をIDで取得するルート
router.get('/:id', userController.getUserById);

// 新規ユーザー作成のルート
router.post('/', userController.createUser);

// 更新用のルート
router.put('/:id', userController.updateUser);

// 削除用のルート
router.delete('/:id', userController.deleteUser);

module.exports = router;
