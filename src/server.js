const express = require('express');
const bodyParser = require('body-parser');
const userRoutes = require('./routes/userRoutes'); // ルートのインポート
const orderRoutes = require('./routes/orderRoutes');
const buyerRoutes = require('./routes/buyerRoutes');


const app = express();

app.use(bodyParser.json()); // JSON リクエストを解析するための設定
app.use('/users', userRoutes); // ユーザールートをアプリに追加
app.use('/api', orderRoutes);  // '/api'パスでorderRoutesを使用するよう設定
app.use('/api/buyers', buyerRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
