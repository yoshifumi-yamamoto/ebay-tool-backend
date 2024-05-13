const express = require('express');
const router = express.Router();
const accountController = require('../controllers/accountController');

router.post('/accounts', accountController.createAccount);
router.get('/accounts/user/:userId', accountController.getAccountsByUserId); // ルートを更新
router.put('/accounts/:id', accountController.updateAccount);

module.exports = router;
