// src/services/userService.js
const db = require('../models');

const createUser = async (userData) => {
  return db.User.create(userData);
};

const getUserById = async (id) => {
  return db.User.findByPk(id);
};

// 他の関数も同様に定義

module.exports = {
  createUser,
  getUserById
};
