const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SERVICE_ACCOUNT_FILE = path.join(__dirname, '../../credentials/service-account-key.json');

const auth = new google.auth.GoogleAuth({
  keyFile: SERVICE_ACCOUNT_FILE,
  scopes: ['https://www.googleapis.com/auth/drive.file']
});

const drive = google.drive({ version: 'v3', auth });

// Google Driveにファイルをアップロードし、共有権限を設定する関数
const uploadFileToGoogleDrive = async (filePath, folderId) => {
  try {
    // ファイルの内容を読み込み、改行コードを統一
    let data = fs.readFileSync(filePath, 'utf8');
    data = data.replace(/\r?\n/g, os.EOL);
    fs.writeFileSync(filePath, data, 'utf8');

    const fileMetadata = {
      name: path.basename(filePath),
      parents: [folderId]
    };

    const media = {
      mimeType: 'text/csv',
      body: fs.createReadStream(filePath)
    };

    const response = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id'
    });

    const fileId = response.data.id;
    console.log('File uploaded to Google Drive with ID:', fileId);

    // ファイルの権限を設定
    await drive.permissions.create({
      fileId: fileId,
      resource: {
        role: 'reader',
        type: 'anyone',
      },
    });

    console.log('Permissions set for file:', fileId);

    return fileId;
  } catch (error) {
    console.error('Error uploading file to Google Drive:', error);
    throw error;
  }
};

module.exports = {
  uploadFileToGoogleDrive
};
