const { Logging } = require('@google-cloud/logging');
require('dotenv').config();

const logging = new Logging({
  projectId: process.env.GCP_PROJECT_ID,  // あなたのプロジェクトIDを指定
  keyFilename: './credentials/service-account-key.json'  // サービスアカウントキーのパス
});


const logger = logging.log('ebay-sync-errors');

async function logError(errorData) {
  const logEntry = {
    severity: 'ERROR',
    jsonPayload: {
      timestamp: new Date().toISOString(),
      logType: 'error',
      itemId: errorData.itemId || 'unknown',
      errorType: errorData.errorType || 'GENERAL_ERROR',
      errorMessage: errorData.errorMessage || 'No error message provided',
      attemptNumber: errorData.attemptNumber || 1,
      additionalInfo: errorData.additionalInfo || {},
    },
  };

  try {
    await logger.write(logger.entry(logEntry));
    console.log(`Logged error for item: ${errorData.itemId}`);
  } catch (err) {
    console.error('Failed to log error to Cloud Logging:', err);
  }
}

module.exports = { logError };