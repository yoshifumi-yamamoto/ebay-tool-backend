const express = require('express');
const cors = require('cors');

// ルートのインポート
const userRoutes = require('./routes/userRoutes');
const orderRoutes = require('./routes/orderRoutes');
const buyerRoutes = require('./routes/buyerRoutes');
const accountRoutes = require('./routes/accountRoutes');
const authRoutes = require('./routes/authRoutes');
const sheetsRoutes = require('./routes/sheetsRoutes');

const app = express();

// 許可するオリジンのリスト
const allowedOrigins = ['http://localhost:3001', 'https://ebay-tool-frontend.vercel.app'];

// CORS設定
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  optionsSuccessStatus: 200 // 一部のブラウザでCORSのリクエストに問題が発生しないようにする
}));

// JSONリクエストの解析
app.use(express.json());

// ルートの設定
app.use('/api/users', userRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/buyers', buyerRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/auth', authRoutes);
app.use("/api/sheets", sheetsRoutes);

// サーバ起動
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
