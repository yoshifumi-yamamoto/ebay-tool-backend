// src/controllers/userController.js
const db = require('../models'); // DBインスタンスの取得

exports.getAllUsers = async (req, res) => {
  try {
    const users = await db.User.findAll();
    res.send(users);
  } catch (error) {
    res.status(500).send(error.message);
  }
};

exports.createUser = async (req, res) => {
  try {
    const user = await db.User.create(req.body);
    res.status(201).send(user);
  } catch (error) {
    res.status(500).send(error.message);
  }
};

// 他の関数も同様に定義
