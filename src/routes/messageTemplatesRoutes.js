const express = require('express');
const router = express.Router();
const messageTemplatesController = require('../controllers/messageTemplatesController');

router.post('/templates', messageTemplatesController.createTemplate);
router.get('/templates', messageTemplatesController.getTemplates);
router.get('/templates/:template_id', messageTemplatesController.getTemplateById);
router.put('/templates/:template_id', messageTemplatesController.updateTemplate);
router.delete('/templates/:template_id', messageTemplatesController.deleteTemplate);

module.exports = router;
