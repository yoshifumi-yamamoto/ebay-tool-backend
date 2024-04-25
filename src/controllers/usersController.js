const supabase = require('../supabaseClient');

// すべてのユーザーを取得
exports.getUsers = async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('*');
  
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json(data);
};

// IDに基づいて特定のユーザーを取得
exports.getUserById = async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  if (data) {
    res.json(data);
  } else {
    res.status(404).json({ message: 'User not found' });
  }
};

// 新規ユーザー作成
exports.createUser = async (req, res) => {
  const { body } = req;
  const { data, error } = await supabase
    .from('users')
    .insert([
      body
    ]);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.status(201).json(data);
};

// IDに基づいてユーザー情報を更新
exports.updateUser = async (req, res) => {
  const { id } = req.params;
  const { body } = req;
  const { data, error } = await supabase
    .from('users')
    .update(body)
    .eq('id', id);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json(data);
};

// IDに基づいてユーザーを削除
exports.deleteUser = async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('users')
    .delete()
    .eq('id', id);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.status(204).json(data);
};