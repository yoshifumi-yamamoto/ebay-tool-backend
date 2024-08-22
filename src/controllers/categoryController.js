const categoryService = require('../services/categoryService');

// Supabaseからカテゴリを取得して返すエンドポイント
async function getCategories(req, res) {
    const parentCategoryId = req.query.parentCategoryId || null; // クエリパラメータからparentCategoryIdを取得
    try {
        const categories = await categoryService.getCategories(parentCategoryId);
        res.status(200).json(categories);
    } catch (error) {
        res.status(500).json({ message: 'Failed to retrieve categories.', error: error.message });
    }
}

async function getChildCategories(req, res) {
    const parentCategoryId = req.params.parentCategoryId; // 親カテゴリIDを取得

    try {
        const childCategories = await categoryService.getChildCategories(parentCategoryId);
        res.status(200).json(childCategories);
    } catch (error) {
        res.status(500).json({ message: 'Failed to retrieve child categories.', error: error.message });
    }
}


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
    getCategories,
    getChildCategories
};
