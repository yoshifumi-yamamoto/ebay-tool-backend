const express = require('express');

const app = express();

const cors = require('cors');
require('dotenv').config();

// ルートのインポート
const userRoutes = require('./routes/userRoutes');
const orderRoutes = require('./routes/orderRoutes');
const buyerRoutes = require('./routes/buyerRoutes');
const accountRoutes = require('./routes/accountRoutes');
const authRoutes = require('./routes/authRoutes');
const sheetsRoutes = require('./routes/sheetsRoutes');
const chatworkRoutes = require('./routes/chatworkRoutes');
const inventoryRoutes = require('./routes/inventoryRoutes');
const taskRoutes = require('./routes/taskRoutes');
const octoparseRoutes = require('./routes/octoparseRoutes');
const scheduleRoutes = require('./routes/scheduleRoutes');
const itemRoutes = require('./routes/itemRoutes'); 
const orderSummaryRoutes = require('./routes/orderSummaryRoutes');
const listingsSummaryRoutes = require('./routes/listingsSummaryRoutes');// 新しいルートの追加

// スケジューラのインポート
const { scheduleInventoryUpdates } = require('./scheduler');

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

app.use((req, res, next) => {
  req.requestTime = Date.now();
  res.on('finish', () => {
    const responseTime = Date.now() - req.requestTime;
    console.log(`${req.method} ${req.originalUrl} took ${responseTime}ms`);
  });
  next();
});

// ルートの設定
app.use('/api/users', userRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/buyers', buyerRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/auth', authRoutes);
app.use("/api/sheets", sheetsRoutes);
app.use("/api/chatwork", chatworkRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/octoparse', octoparseRoutes); 
app.use('/api/schedule', scheduleRoutes);
app.use('/api/items', itemRoutes); 
app.use('/api/order-summary', orderSummaryRoutes); 
app.use('/api/listings-summary', listingsSummaryRoutes);// 新しいルートの追加

// スケジューラを環境変数に基づいて起動
if (process.env.ENABLE_SCHEDULER === 'true') {
  scheduleInventoryUpdates();
}

module.exports = app;