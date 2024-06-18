const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const SERVICE_ACCOUNT_FILE = path.join(__dirname, '../../credentials/service-account-key.json');

const auth = new google.auth.GoogleAuth({
  keyFile: SERVICE_ACCOUNT_FILE,
  scopes: ['https://www.googleapis.com/auth/drive.file']
});

const drive = google.drive({ version: 'v3', auth });

// Google Driveにファイルをアップロードする関数
const uploadFileToGoogleDrive = async (filePath, folderId) => {
  try {
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

    console.log('File uploaded to Google Drive with ID:', response.data.id);
    return response.data.id;
  } catch (error) {
    console.error('Error uploading file to Google Drive:', error);
    throw error;
  }
};

module.exports = {
  uploadFileToGoogleDrive
};
