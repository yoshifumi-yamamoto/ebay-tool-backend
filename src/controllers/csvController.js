const { updateCategoriesFromCSV, updateTrafficFromCSV, updateActiveListingsCSV, updateShippingCostsFromCSV, updateCarrierInvoicesFromCSV } = require('../services/csvService');
const { Readable } = require('stream');

const processCSVUpload = async (req, res) => {
    const { fileType, report_month, ebay_user_id, user_id } = req.body;
    console.log('Inside processCSVUpload');
    console.log('Request body:', req.body);
    console.log('Uploaded file:', req.file);

    const file = req.file;

    // 追加のデバッグ用ログ
    console.log('fileType:', fileType);
    console.log('report_month:', report_month);
    console.log('ebay_user_id:', ebay_user_id);
    console.log('user_id:', user_id);

    if (!file) {
        console.error('No file uploaded');
        return res.status(400).json({ error: 'No file uploaded' });
    }

    if (!user_id) {
        console.error('user_id is required');
        return res.status(400).json({ error: 'user_id is required' });
    }

    if (!ebay_user_id) {
        console.error('ebay_user_id is required');
        return res.status(400).json({ error: 'ebay_user_id is required' });
    }

    try {
        const bufferStream = new Readable();
        bufferStream.push(file.buffer);
        bufferStream.push(null);

        if (fileType === 'category') {
            await updateCategoriesFromCSV(bufferStream, report_month, ebay_user_id, user_id);
            res.status(200).json({ message: 'Category CSV processed successfully' });
        } else if (fileType === 'traffic') {
            if (!report_month) {
                console.error('report_month is required');
                return res.status(400).json({ error: 'report_month is required for traffic CSV' });
            }
            await updateTrafficFromCSV(bufferStream, report_month, ebay_user_id, user_id);
            res.status(200).json({ message: 'Traffic CSV processed successfully' });
        } else {
            console.error('Invalid fileType');
            return res.status(400).json({ error: 'Invalid fileType' });
        }
    } catch (error) {
        console.error(`Error processing ${fileType} file:`, error.message);
        res.status(500).json({ error: `Error processing ${fileType} file` });
    }
};

const processActiveListingsCSVUpload = async (req, res) => {
    const { ebay_user_id, user_id } = req.body;
    console.log('Inside processCSVUpload');

    const file = req.file;

    // 追加のデバッグ用ログ
    console.log('ebay_user_id:', ebay_user_id);
    console.log('user_id:', user_id);

    if (!file) {
        console.error('No file uploaded');
        return res.status(400).json({ error: 'No file uploaded' });
    }

    if (!user_id) {
        console.error('user_id is required');
        return res.status(400).json({ error: 'user_id is required' });
    }

    if (!ebay_user_id) {
        console.error('ebay_user_id is required');
        return res.status(400).json({ error: 'ebay_user_id is required' });
    }

    try {
        const bufferStream = new Readable();
        bufferStream.push(file.buffer);
        bufferStream.push(null);

        await updateActiveListingsCSV(bufferStream, ebay_user_id, user_id);

    } catch (error) {
        console.error(`Error processActiveListingsCSVUpload :`, error.message);
        res.status(500).json({ error: `Error processActiveListingsCSVUpload` });
    }
};

const processShippingCostsCSVUpload = async (req, res) => {
    const { user_id } = req.body;

    const file = req.file;

    if (!file) {
        console.error('No file uploaded');
        return res.status(400).json({ error: 'No file uploaded' });
    }

    if (!user_id) {
        console.error('user_id is required');
        return res.status(400).json({ error: 'user_id is required' });
    }

    try {
        const bufferStream = new Readable();
        bufferStream.push(file.buffer);
        bufferStream.push(null);

        const result = await updateShippingCostsFromCSV(bufferStream, user_id);
        res.status(200).json({ message: 'Shipping costs CSV processed', result });
    } catch (error) {
        console.error('Error processing shipping costs CSV:', error.message);
        res.status(500).json({ error: 'Error processing shipping costs CSV' });
    }
};

const processCarrierInvoicesCSVUpload = async (req, res) => {
    const file = req.file;

    if (!file) {
        console.error('No file uploaded');
        return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
        const bufferStream = new Readable();
        bufferStream.push(file.buffer);
        bufferStream.push(null);

        const result = await updateCarrierInvoicesFromCSV(bufferStream, file.originalname);
        res.status(200).json({ message: 'Carrier invoice CSV processed', result });
    } catch (error) {
        console.error('Error processing carrier invoice CSV:', error.message);
        res.status(500).json({ error: 'Error processing carrier invoice CSV' });
    }
};

module.exports = {
    processCSVUpload,
    processActiveListingsCSVUpload,
    processShippingCostsCSVUpload,
    processCarrierInvoicesCSVUpload,
};
