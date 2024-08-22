const axios = require('axios');
const supabase = require('../supabaseClient');

// Supabaseからカテゴリを取得する関数
async function getCategories(parentCategoryId = null) {
    try {
        let query = supabase
            .from('categories')
            .select('*')
            .order('category_name', { ascending: true });

        if (parentCategoryId) {
            query = query.eq('parent_category_id', parentCategoryId);
        } else {
            query = query.is('parent_category_id', null); // ルートカテゴリを取得
        }

        const { data, error } = await query;

        if (error) {
            console.error('Error fetching categories from Supabase:', error.message);
            throw error;
        }

        // 親カテゴリがnullの場合、さらにその子カテゴリを取得
        if (parentCategoryId === null && data.length > 0) {
            const rootCategoryIds = data.map(category => category.category_id);
            const childCategoriesQuery = supabase
                .from('categories')
                .select('*')
                .in('parent_category_id', rootCategoryIds)
                .order('category_name', { ascending: true });

            const { data: childCategories, error: childError } = await childCategoriesQuery;

            if (childError) {
                console.error('Error fetching child categories from Supabase:', childError.message);
                throw childError;
            }

            return [...data, ...childCategories];
        }

        return data;
    } catch (error) {
        console.error('Error in getCategories:', error.message);
        throw error;
    }
}

// 特定の親カテゴリIDに基づいて子カテゴリを取得する関数
async function getChildCategories(parentCategoryId) {
    try {
        const { data, error } = await supabase
            .from('categories')
            .select('*')
            .eq('parent_category_id', parentCategoryId)
            .order('category_name', { ascending: true });

        if (error) {
            console.error('Error fetching child categories from Supabase:', error.message);
            throw error;
        }

        return data;
    } catch (error) {
        console.error('Error in getChildCategories:', error.message);
        throw error;
    }
}



// eBay APIからカテゴリを取得し、Supabaseに同期する関数
async function fetchCategories(categoryTreeId = '0', parentCategoryId = null) {
    try {
        const response = await axios.get(`https://api.ebay.com/commerce/taxonomy/v1/category_tree/${categoryTreeId}`, {
            headers: {
                'Authorization': `Bearer token`, // ここに正しいeBay APIトークンを入力してください
                'Content-Type': 'application/json'
            }
        });

        const rootCategoryNode = response.data.rootCategoryNode;
        await processCategoryNode(rootCategoryNode, parentCategoryId);
    } catch (error) {
        console.error('Error fetching categories:', error.message);
        throw error;
    }
}

async function processCategoryNode(node, parentCategoryId) {
    const categoriesBatch = [];

    const processNode = async (currentNode, parentCategoryId) => {
        const categoryId = currentNode.category.categoryId;
        const categoryName = currentNode.category.categoryName;
        const categoryLevel = parentCategoryId ? 1 : 0;

        categoriesBatch.push({
            category_id: categoryId,
            category_name: categoryName,
            parent_category_id: parentCategoryId,
            category_level: categoryLevel
        });

        if (currentNode.childCategoryTreeNodes) {
            for (const childNode of currentNode.childCategoryTreeNodes) {
                await processNode(childNode, categoryId);
            }
        }
    };

    await processNode(node, parentCategoryId);

    // バッチごとにSupabaseにアップサート
    const batchSize = 100;
    for (let i = 0; i < categoriesBatch.length; i += batchSize) {
        const batch = categoriesBatch.slice(i, i + batchSize);
        await upsertCategoryBatch(batch);
    }
}

async function upsertCategoryBatch(batch) {
    try {
        const { data, error } = await supabase
            .from('categories')
            .upsert(batch, { onConflict: ['category_id'] });

        if (error) {
            console.error(`Supabase upsert error: ${error.message}`, error.details);
        } else if (!data) {
            console.error('Supabase upsert returned null data');
        } else {
            console.log(`Successfully upserted ${data.length} categories.`);
        }
    } catch (error) {
        console.error('Error during upsert:', error.message);
    }
}

module.exports = {
    fetchCategories,
    getCategories,
    getChildCategories
};
