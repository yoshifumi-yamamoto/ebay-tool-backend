const express = require('express');
const router = express.Router();
const controller = require('../controllers/priorityQuadrantController');

router.get('/quadrants', controller.getQuadrants);
router.post('/quadrants', controller.createQuadrant);
router.put('/quadrants/:id', controller.updateQuadrant);
router.delete('/quadrants/:id', controller.deleteQuadrant);

router.get('/memos', controller.getMemos);
router.post('/memos', controller.upsertMemo);
router.delete('/memos/:id', controller.deleteMemo);

module.exports = router;
