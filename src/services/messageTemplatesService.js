const supabase = require('../supabaseClient');

exports.createTemplate = async (templateData) => {
  const { data, error } = await supabase
    .from('message_templates')
    .insert([templateData])
    .select();

  if (error) {
    throw error;
  }
  return data[0];
};

exports.getTemplates = async () => {
  const { data, error } = await supabase
    .from('message_templates')
    .select('*');

  if (error) {
    throw error;
  }
  return data;
};

exports.getTemplateById = async (templateId) => {
  const { data, error } = await supabase
    .from('message_templates')
    .select('*')
    .eq('id', templateId)
    .single();

  if (error) {
    throw error;
  }
  return data;
};

exports.updateTemplate = async (templateId, templateData) => {
  const { data, error } = await supabase
    .from('message_templates')
    .update(templateData)
    .eq('id', templateId)
    .select();

  if (error) {
    throw error;
  }
  return data[0];
};

exports.deleteTemplate = async (templateId) => {
  const { error } = await supabase
    .from('message_templates')
    .delete()
    .eq('id', templateId);

  if (error) {
    throw error;
  }
};
