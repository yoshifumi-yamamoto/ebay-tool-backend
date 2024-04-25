// src/controllers/userController.js

const supabase = require('../supabaseClient');

exports.getAllUsers = async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('*');
  
  if (error) {
    console.error('Error fetching users:', error);
    return res.status(500).json({ error: error.message });
  }

  res.json(data);
};

exports.createUser = async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .insert([req.body]);
  
  if (error) {
    console.error('Error creating user:', error);
    return res.status(500).json({ error: error.message });
  }

  res.status(201).json(data);
};

exports.getUserById = async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', req.params.id);

  if (error) {
    console.error('Error fetching user:', error);
    return res.status(500).json({ error: error.message });
  }

  if (data.length === 0) {
    return res.status(404).json({ message: 'User not found' });
  }

  res.json(data[0]);
};
