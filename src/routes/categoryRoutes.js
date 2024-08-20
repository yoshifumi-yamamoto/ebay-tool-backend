const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/categoryController');

router.get('/sync', categoryController.syncCategories);

module.exports = router;
