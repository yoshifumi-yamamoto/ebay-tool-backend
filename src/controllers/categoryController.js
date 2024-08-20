const categoryService = require('../services/categoryService');

async function syncCategories(req, res) {
    try {
        await categoryService.fetchCategories('0');
        res.status(200).json({ message: 'Categories synchronized successfully.' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to synchronize categories.', error: error.message });
    }
}

module.exports = {
    syncCategories,
};
