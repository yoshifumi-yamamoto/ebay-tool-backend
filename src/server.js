const express = require('express');
const bodyParser = require('body-parser');
const userRoutes = require('./routes/userRoutes'); // ルートのインポート

const app = express();

app.use(bodyParser.json()); // JSON リクエストを解析するための設定
app.use('/users', userRoutes); // ユーザールートをアプリに追加

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
