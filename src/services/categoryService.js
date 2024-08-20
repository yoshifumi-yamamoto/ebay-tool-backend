const axios = require('axios');
const supabase = require('../supabaseClient');

async function fetchCategories(categoryTreeId = '0', parentCategoryId = null) {
    try {
        const response = await axios.get(`https://api.ebay.com/commerce/taxonomy/v1/category_tree/${categoryTreeId}`, {
            headers: {
                'Authorization': `Bearer v^1.1#i^1#p^3#I^3#r^0#f^0#t^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`, // ここに正しいeBay APIトークンを入力してください
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
};
