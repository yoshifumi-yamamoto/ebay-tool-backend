const express = require('express');
const { getAllOctoparseData } = require('../controllers/octoparseController');
const router = express.Router();

router.get('/fetch-all-data', getAllOctoparseData);

module.exports = router;
