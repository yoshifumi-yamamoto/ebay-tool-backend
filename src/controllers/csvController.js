const { updateCategoriesFromCSV, updateTrafficFromCSV } = require('../services/csvService');
const { Readable } = require('stream');

const processCSVUpload = async (req, res) => {
    const { fileType, month } = req.body;
    const file = req.file;

    if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
        // バッファをストリームとして扱う
        const bufferStream = new Readable();
        bufferStream.push(file.buffer);
        bufferStream.push(null);  // ストリームの終わりを示す

        if (fileType === 'category') {
            await updateCategoriesFromCSV(bufferStream);
            res.status(200).json({ message: 'Category CSV processed successfully' });
        } else if (fileType === 'traffic') {
            if (!month) {
                return res.status(400).json({ error: 'Month is required for traffic CSV' });
            }
            await updateTrafficFromCSV(bufferStream, month);
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
