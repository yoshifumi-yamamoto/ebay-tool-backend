const { google } = require('googleapis');
const { join } = require('path');

const SERVICE_ACCOUNT_FILE = join(__dirname, '../credentials/service-account-key.json');

const auth = new google.auth.GoogleAuth({
  keyFile: SERVICE_ACCOUNT_FILE,
  scopes: ['https://www.googleapis.com/auth/drive.file']
});

const drive = google.drive({ version: 'v3', auth });

module.exports = drive;
