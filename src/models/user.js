// src/models/user.js
const user = {
  id: 'serial primary key',
  username: 'varchar(255)',
  email: 'varchar(255) unique',
  password: 'varchar(255)'
};

module.exports = user;
