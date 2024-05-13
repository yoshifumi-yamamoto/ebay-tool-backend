const express = require('express');
const router = express.Router();
const accountController = require('../controllers/accountController');

router.post('/', accountController.createAccount);
router.get('/user/:userId', accountController.getAccountsByUserId); // ルートを更新
router.put('/:id', accountController.updateAccount);

module.exports = router;
