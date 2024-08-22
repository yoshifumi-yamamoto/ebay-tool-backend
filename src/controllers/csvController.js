const { updateCategoriesFromCSV, updateTrafficFromCSV } = require('../services/csvService');
const { Readable } = require('stream');

const processCSVUpload = async (req, res) => {
    const { fileType, month, user_id } = req.body; // user_id を取得
    const file = req.file;

    if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    if (!user_id) {
        return res.status(400).json({ error: 'user_id is required' });
    }

    try {
        const bufferStream = new Readable();
        bufferStream.push(file.buffer);
        bufferStream.push(null); 

        if (fileType === 'category') {
            await updateCategoriesFromCSV(bufferStream, user_id); // user_id を渡す
            res.status(200).json({ message: 'Category CSV processed successfully' });
        } else if (fileType === 'traffic') {
            if (!month) {
                return res.status(400).json({ error: 'Month is required for traffic CSV' });
            }
            await updateTrafficFromCSV(bufferStream, month, user_id); // user_id を渡す
            res.status(200).json({ message: 'Traffic CSV processed successfully' });
        } else {
            return res.status(400).json({ error: 'Invalid fileType' });
        }
    } catch (error) {
        console.error(`Error processing ${fileType} file:`, error.message);
        res.status(500).json({ error: `Error processing ${fileType} file` });
    }
};


module.exports = {
    processCSVUpload,
};
