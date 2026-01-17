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
const ownerDashboardRoutes = require('./routes/ownerDashboardRoutes');
const shipmentGroupRoutes = require('./routes/shipmentGroupRoutes');
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
const systemErrorRoutes = require('./routes/systemErrorRoutes');
const packingVerificationRoutes = require('./routes/packingVerificationRoutes');
const countryCodeRoutes = require('./routes/countryCodeRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');

// スケジューラのインポート
const { scheduleInventoryUpdates } = require('./scheduler');
const { CronJob } = require('cron');
const { spawn } = require('child_process');

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
app.use('/api/owner-dashboard', ownerDashboardRoutes);
app.use("/api/shipment-groups", shipmentGroupRoutes);
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
app.use('/api/system-errors', systemErrorRoutes);
app.use('/api/packing-verification', packingVerificationRoutes);
app.use('/api/country-codes', countryCodeRoutes);
app.use('/api/dashboard', dashboardRoutes);

// スケジューラを環境変数に基づいて起動
if (process.env.ENABLE_SCHEDULER === 'true') {
  scheduleInventoryUpdates();

  const runCurl = (label, args) =>
    new Promise((resolve, reject) => {
      const curl = spawn('curl', ['-sS', '-o', '/dev/null', '-w', '%{http_code}', ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      curl.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      curl.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      curl.on('error', (err) => {
        console.error(`${label} failed to spawn:`, err);
        reject(err);
      });
      curl.on('close', (code) => {
        const status = stdout.trim() || 'unknown';
        if (code !== 0 || stderr) {
          console.error(`${label} failed: exit=${code} status=${status} err=${stderr.trim()}`);
          reject(new Error(`${label} failed`));
          return;
        }
        console.log(`${label} success: status=${status}`);
        resolve(status);
      });
    });

  // 深夜1時にsync APIを実行するCronJob
  const runSyncApiJob = new CronJob('0 1 * * *', () => {
      runCurl('sync listings', ['-X', 'GET', `${baseUrl}/api/listings/sync?userId=2`]).catch(() => {});
  }, null, true, 'Asia/Tokyo');

  // CronJobの開始
  runSyncApiJob.start();

    // 毎週月曜日の深夜1時にsync-ended-listings APIを実行するCronJob
    const runSyncEndedListingsApiJob = new CronJob('0 1 * * 1', () => {
      runCurl('sync ended listings', ['-X', 'GET', `${baseUrl}/api/listings/sync-ended-listings?userId=2`]).catch(() => {});
  }, null, true, 'Asia/Tokyo');

  // CronJobの開始
  runSyncEndedListingsApiJob.start();

  // 毎週月曜日の7時にChatworkのAPIを実行するCronJob
  const runChatworkApiJob = new CronJob('0 7 * * 1', () => {
    runCurl('chatwork last-week-orders', ['-X', 'GET', `${baseUrl}/api/chatwork/last-week-orders/2`]).catch(() => {});
  }, null, true, 'Asia/Tokyo');

  runChatworkApiJob.start();

  // スプレッドシートのデータを同期する
  const runSyncSheetJob = new CronJob('0 6,12,18 * * *', () => {
    console.log('Starting sync-sheet API call...');
    runCurl('sync sheet', [
      '-X',
      'POST',
      `${baseUrl}/api/sheets/sync-sheet`,
      '-H',
      'Content-Type: application/json',
      '-d',
      '{"userId": 2}',
    ])
      .then(() => {
        console.log('Starting sync-all-ebay-data API call...');
        return runCurl('sync all ebay data', ['-X', 'GET', `${baseUrl}/api/orders/sync-all-ebay-data/user/2`]);
      })
      .catch(() => {});
  }, null, true, 'Asia/Tokyo');

  // スケジュールジョブの開始
  runSyncSheetJob.start();
}

module.exports = app;
