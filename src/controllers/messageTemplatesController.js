const messageTemplatesService = require('../services/messageTemplatesService');

exports.createTemplate = async (req, res) => {
  try {
    const template = await messageTemplatesService.createTemplate(req.body);
    res.status(201).json(template);
  } catch (error) {
    console.error('Error creating template:', error);
    res.status(400).json({ message: 'Failed to create template' });
  }
};

exports.getTemplates = async (req, res) => {
  try {
    const templates = await messageTemplatesService.getTemplates();
    res.status(200).json(templates);
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({ message: 'Failed to fetch templates' });
  }
};

exports.getTemplateById = async (req, res) => {
  try {
    const template = await messageTemplatesService.getTemplateById(req.params.template_id);
    if (template) {
      res.status(200).json(template);
    } else {
      res.status(404).json({ message: 'Template not found' });
    }
  } catch (error) {
    console.error('Error fetching template:', error);
    res.status(500).json({ message: 'Failed to fetch template' });
  }
};

exports.updateTemplate = async (req, res) => {
  try {
    const template = await messageTemplatesService.updateTemplate(req.params.template_id, req.body);
    res.status(200).json(template);
  } catch (error) {
    console.error('Error updating template:', error);
    res.status(400).json({ message: 'Failed to update template' });
  }
};

exports.deleteTemplate = async (req, res) => {
  try {
    await messageTemplatesService.deleteTemplate(req.params.template_id);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting template:', error);
    res.status(404).json({ message: 'Template not found' });
  }
};
