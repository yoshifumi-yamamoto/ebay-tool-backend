const express = require('express');
const { getSystemErrors } = require('../controllers/systemErrorController');

const router = express.Router();

router.get('/', getSystemErrors);

module.exports = router;
