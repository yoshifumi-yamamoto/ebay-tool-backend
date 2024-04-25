const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');  // Supabaseクライアントをインポート
const usersController = require('../controllers/usersController');


// 全ユーザーの情報を取得するルート
router.get('/', usersController.getUsers);

// 特定のユーザーの情報をIDで取得するルート
router.get('/:id', usersController.getUserById);

// 新規ユーザー作成のルート
router.post('/', usersController.createUser);

// 更新用のルート
router.patch('/:id', usersController.updateUser);

// 削除用のルート
router.delete('/:id', usersController.deleteUser);

module.exports = router;

// // 全ユーザーの情報を取得するルート
// router.get('/', async (req, res) => {
//   try {
//     const { data, error } = await supabase
//       .from('users')
//       .select('*');

//     if (error) {
//       throw error;
//     }

//     res.json(data);
//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// });

// // 特定のユーザーの情報をIDで取得するルート
// router.get('/:id', async (req, res) => {
//   const { id } = req.params;

//   try {
//     const { data, error } = await supabase
//       .from('users')
//       .select('*')
//       .eq('id', id);

//     if (error) {
//       throw error;
//     }

//     if (data.length === 0) {
//       return res.status(404).json({ message: 'User not found' });
//     }

//     res.json(data[0]);
//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// });

// // 新しいユーザーを作成するルート
// router.post('/', async (req, res) => {
//   const { username, email } = req.body;

//   try {
//     const { data, error } = await supabase
//       .from('users')
//       .insert([{ username, email }]);

//     if (error) {
//       throw error;
//     }

//     res.status(201).json(data);
//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// });

// // ユーザー情報を更新するルート
// router.patch('/:id', async (req, res) => {
//   const { id } = req.params;
//   const updates = req.body;

//   try {
//     const { data, error } = await supabase
//       .from('users')
//       .update(updates)
//       .match({ id });

//     if (error) {
//       throw error;
//     }

//     if (data.length === 0) {
//       return res.status(404).json({ message: 'User not found' });
//     }

//     res.json(data);
//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// });

// // ユーザーを削除するルート
// router.delete('/:id', async (req, res) => {
//   const { id } = req.params;

//   try {
//     const { data, error } = await supabase
//       .from('users')
//       .delete()
//       .match({ id });

//     if (error) {
//       throw error;
//     }

//     res.json(data);
//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// });

// module.exports = router;
