const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const drive = require('../googleDriveClient');

async function uploadFileToGoogleDrive(filePath, folderId) {
  console.log("filePath",filePath)
  console.log("folderId",folderId)
    const fileMetadata = {
        name: path.basename(filePath),
        parents: [folderId]  // フォルダIDを指定
    };
    const media = {
        mimeType: 'text/csv',
        body: fs.createReadStream(filePath)
    };

    try {
        const response = await drive.files.create({
            resource: fileMetadata,
            media: media,
            fields: 'id'
        });
        console.log('File uploaded successfully:', response.data.id);
    } catch (error) {
        console.error('Error uploading file:', error);
    }
}

module.exports = { uploadFileToGoogleDrive };
