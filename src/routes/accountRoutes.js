const express = require('express');
const router = express.Router();
const accountController = require('../controllers/accountController');
const { getAccountListings } = require('../controllers/accountListingController');

router.post('/', accountController.createAccount);
router.get('/user/:userId', accountController.getAccountsByUserId); 
router.put('/:id', accountController.updateAccount);
router.get('/listings', getAccountListings);

module.exports = router;
