const express = require('express');
const router = express.Router();
const htsCodeController = require('../controllers/htsCodeController');

router.get('/', htsCodeController.listHtsCodes);
router.post('/', htsCodeController.createHtsCode);
router.put('/:id', htsCodeController.updateHtsCode);
router.delete('/:id', htsCodeController.deleteHtsCode);

module.exports = router;
