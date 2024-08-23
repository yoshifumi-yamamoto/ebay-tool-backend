const { searchItems } = require('../services/itemSearchService');

async function getItems(req, res) {
  console.log(("getItems"))
  
    try {
        const queryParams = req.body; // POSTリクエストからボディを取得
        console.log({queryParams})

        if (!queryParams.user_id || !queryParams.report_month) {
            console.log(("getItems if"))
            return res.status(400).json({ error: 'user_id and report_month are required' });
        }

        const result = await searchItems(queryParams);
        return res.status(200).json(result);
    } catch (error) {
        console.error('Error in getItems:', error.message);
        return res.status(500).json({ error: 'Failed to retrieve items' });
    }
}

module.exports = { getItems };
