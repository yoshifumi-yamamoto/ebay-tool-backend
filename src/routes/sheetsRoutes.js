const express = require('express');
const router = express.Router();
const { syncSheetToSupabase } = require('../controllers/sheetsController');

router.post('/sync-sheet', syncSheetToSupabase);

module.exports = router;
