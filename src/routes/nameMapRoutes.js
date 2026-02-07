const express = require('express');
const router = express.Router();
const nameMapController = require('../controllers/nameMapController');

router.get('/', nameMapController.listNameMaps);
router.post('/', nameMapController.createNameMap);
router.put('/:id', nameMapController.updateNameMap);
router.delete('/:id', nameMapController.deleteNameMap);

module.exports = router;
