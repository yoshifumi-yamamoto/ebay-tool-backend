const express = require('express');
const router = express.Router();
const caseController = require('../controllers/caseController');

router.get('/', caseController.listCases);
router.post('/sync', caseController.syncCases);

module.exports = router;
