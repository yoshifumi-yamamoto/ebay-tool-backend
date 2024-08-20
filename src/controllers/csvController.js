const { updateCategoriesFromCSV, updateTrafficFromCSV } = require('../services/csvService');
const fs = require('fs');

const processCSVUpload = async (req, res) => {
    const { fileType, month } = req.body;
    const file = req.file;

    if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
        if (fileType === 'category') {
            await updateCategoriesFromCSV(file.path);
            res.status(200).json({ message: 'Category CSV processed successfully' });
        } else if (fileType === 'traffic') {
            if (!month) {
                return res.status(400).json({ error: 'Month is required for traffic CSV' });
            }
            await updateTrafficFromCSV(file.path, month);
            res.status(200).json({ message: 'Traffic CSV processed successfully' });
        } else {
            return res.status(400).json({ error: 'Invalid fileType' });
        }
    } catch (error) {
        console.error(`Error processing ${fileType} file:`, error.message);
        res.status(500).json({ error: `Error processing ${fileType} file` });
    } finally {
        fs.unlinkSync(file.path);
    }
};

module.exports = {
    processCSVUpload,
};
