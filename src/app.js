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
const listingsSummaryRoutes = require('./routes/listingsSummaryRoutes');
const messageTemplatesRoutes = require('./routes/messageTemplatesRoutes'); 
const listingRoutes = require('./routes/listingRoutes');
const csvRoutes = require('./routes/csvRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const itemSearchRoutes = require('./routes/itemSearchRoutes');
const marketingRoutes = require('./routes/marketingRoutes');
const webhookRoutes = require('./routes/webhookRoutes');
const caseRoutes = require('./routes/caseRoutes');

// スケジューラのインポート
const { scheduleInventoryUpdates } = require('./scheduler');
const { CronJob } = require('cron');
const { exec } = require('child_process');

// 許可するオリジンのリスト
const allowedOrigins = [
  'http://localhost:3001',
  'http://localhost:5175',
  'https://ebay-tool-frontend.vercel.app',
  'https://4b15-126-158-234-2.ngrok-free.app'
];

// サーバーポート（Cronの内部呼び出し用にも使用）
const SERVER_PORT = process.env.PORT || 4321;
const baseUrl = `http://localhost:${SERVER_PORT}`;

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true, // 必要に応じてクレデンシャルを許可
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));

// CORS設定
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, origin); // ヘッダーに1つのオリジンのみ設定
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

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
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
app.use('/api/listings-summary', listingsSummaryRoutes);
app.use('/api/message-templates', messageTemplatesRoutes); 
app.use('/api/listings', listingRoutes);
app.use('/api/csv', csvRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/item-search', itemSearchRoutes);
app.use('/api/marketing', marketingRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/cases', caseRoutes);

// スケジューラを環境変数に基づいて起動
if (process.env.ENABLE_SCHEDULER === 'true') {
  scheduleInventoryUpdates();

  // 深夜1時にsync APIを実行するCronJob
  const runSyncApiJob = new CronJob('0 1 * * *', () => {
      exec(`curl -X GET "${baseUrl}/api/listings/sync?userId=2"`, (error, stdout, stderr) => {
          if (error) {
              console.error(`Error executing sync API: ${error}`);
              return;
          }
          if (stderr) {
              console.error(`Error output: ${stderr}`);
              return;
          }
          console.log(`Sync API response: ${stdout}`);
      });
  }, null, true, 'Asia/Tokyo');

  // CronJobの開始
  runSyncApiJob.start();

    // 毎週月曜日の深夜1時にsync-ended-listings APIを実行するCronJob
    const runSyncEndedListingsApiJob = new CronJob('0 1 * * 1', () => {
      exec(`curl -X GET "${baseUrl}/api/listings/sync-ended-listings?userId=2"`, (error, stdout, stderr) => {
          if (error) {
              console.error(`Error executing sync API: ${error}`);
              return;
          }
          if (stderr) {
              console.error(`Error output: ${stderr}`);
              return;
          }
          console.log(`Sync API response: ${stdout}`);
      });
  }, null, true, 'Asia/Tokyo');

  // CronJobの開始
  runSyncEndedListingsApiJob.start();

  // 毎週月曜日の7時にChatworkのAPIを実行するCronJob
  const runChatworkApiJob = new CronJob('0 7 * * 1', () => {
    exec(`curl -X GET "${baseUrl}/api/chatwork/last-week-orders/2"`, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error executing Chatwork API: ${error}`);
            return;
        }
        if (stderr) {
            console.error(`Error output: ${stderr}`);
            return;
        }
        console.log(`Chatwork API response: ${stdout}`);
    });
  }, null, true, 'Asia/Tokyo');

  runChatworkApiJob.start();

  // スプレッドシートのデータを同期する
  const runSyncSheetJob = new CronJob('0 6,12,18 * * *', () => {
    console.log('Starting sync-sheet API call...');
    exec(`curl -X POST "${baseUrl}/api/sheets/sync-sheet" -H "Content-Type: application/json" -d '{"userId": 2}'`, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error executing sync-sheet API: ${error}`);
      }
      if (stderr) {
        console.error(`Error output from sync-sheet API: ${stderr}`);
      }
      console.log(`sync-sheet API response: ${stdout}`);

      // sync-sheetが完了した後にsync-all-ebay-dataを実行
      console.log('Starting sync-all-ebay-data API call...');
      exec(`curl -X GET "${baseUrl}/api/orders/sync-all-ebay-data/user/2"`, (error, stdout, stderr) => {
        if (error) {
          console.error(`Error executing sync-all-ebay-data API: ${error}`);
          return;
        }
        if (stderr) {
          console.error(`Error output from sync-all-ebay-data API: ${stderr}`);
          return;
        }
        console.log(`sync-all-ebay-data API response: ${stdout}`);
      });
    });
  }, null, true, 'Asia/Tokyo');

  // スケジュールジョブの開始
  runSyncSheetJob.start();
}

module.exports = app;
