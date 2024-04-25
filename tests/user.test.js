// テストファイル: tests/user.test.js
const request = require('supertest');
const app = require('../src/app');  // Expressアプリケーションをインポート

describe('GET /users', () => {
  test('It should respond with an array of users', async () => {
    const response = await request(app).get('/users');
    expect(response.statusCode).toBe(200);
    expect(response.body).toBeInstanceOf(Array);
  });

  test('It should handle errors', async () => {
    const response = await request(app).get('/users');
    expect(response.statusCode).not.toBe(500);
  });
});
