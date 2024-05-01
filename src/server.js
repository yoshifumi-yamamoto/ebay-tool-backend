const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const userRoutes = require('./routes/userRoutes'); // ルートのインポート
const orderRoutes = require('./routes/orderRoutes');
const buyerRoutes = require('./routes/buyerRoutes');
const authRoutes = require('./routes/authRoutes'); // authRoutesのインポート

const app = express();
app.use(cors({
  // origin: 'http://localhost:3001' // Reactアプリケーションが実行されているオリジンを指定
}));


app.use(bodyParser.json()); // JSON リクエストを解析するための設定
app.use('/users', userRoutes); // ユーザールートをアプリに追加
app.use('/api', orderRoutes);  // '/api'パスでorderRoutesを使用するよう設定
app.use('/api/buyers', buyerRoutes);
app.use('/auth', authRoutes); // 認証ルートをアプリに追加

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
