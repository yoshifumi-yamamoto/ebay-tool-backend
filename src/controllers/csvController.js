const { updateCategoriesFromCSV, updateTrafficFromCSV } = require('../services/csvService');
const fs = require('fs');
const path = require('path');

const processCSVUpload = async (req, res) => {
    const { fileType, month } = req.body;
    const file = req.file;

    if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
        // メモリ上のバッファを一時ファイルに書き出す
        const tempFilePath = path.join(__dirname, 'temp.csv');
        fs.writeFileSync(tempFilePath, file.buffer);

        if (fileType === 'category') {
            await updateCategoriesFromCSV(tempFilePath);
            res.status(200).json({ message: 'Category CSV processed successfully' });
        } else if (fileType === 'traffic') {
            if (!month) {
                return res.status(400).json({ error: 'Month is required for traffic CSV' });
            }
            await updateTrafficFromCSV(tempFilePath, month);
            res.status(200).json({ message: 'Traffic CSV processed successfully' });
        } else {
            return res.status(400).json({ error: 'Invalid fileType' });
        }
    } catch (error) {
        console.error(`Error processing ${fileType} file:`, error.message);
        res.status(500).json({ error: `Error processing ${fileType} file` });
    } finally {
        // 一時ファイルを削除
        fs.unlinkSync(tempFilePath);
    }
};

module.exports = {
    processCSVUpload,
};
