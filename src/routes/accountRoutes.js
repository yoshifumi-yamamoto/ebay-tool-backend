const express = require('express');
const router = express.Router();
const accountController = require('../controllers/accountController');

router.post('/', accountController.addAccount);
router.get('/', accountController.getAccounts);

module.exports = router;
