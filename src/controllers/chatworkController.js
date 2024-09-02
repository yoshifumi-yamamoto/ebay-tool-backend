const chatworkService = require('../services/chatworkService');

async function sendWeeklySalesInfo(req, res) {
    const { userId } = req.params;
    // const { token, roomId } = req.body;
    const token = "fe73ec22fd5f0fccee3c07859fa9bcef"
    const roomId = "305985770"
    // マイチャット(テスト用)
    // const roomId = "217594322"

    try {
        await chatworkService.createWeeklySalesMessage(userId, token, roomId);
        res.status(200).json({ message: 'Weekly sales information sent to Chatwork successfully.' });
    } catch (error) {
        console.error('Error sending weekly sales info to Chatwork:', error.message);
        res.status(500).json({ error: 'Failed to send weekly sales info to Chatwork.' });
    }
}

module.exports = {
    sendWeeklySalesInfo
};
