const chatworkService = require('../services/chatworkService');
const { logError } = require('../services/loggingService');

async function sendWeeklySalesInfo(req, res) {
    const { userId } = req.params;
    const token = process.env.CHATWORK_TOKEN;
    const roomId = process.env.CHATWORK_ROOM_ID;

    try {
        await chatworkService.createWeeklySalesMessage(userId, token, roomId);
        res.status(200).json({ message: 'Weekly sales information sent to Chatwork successfully.' });
    } catch (error) {
        console.error('Error sending weekly sales info to Chatwork:', error.message);

        await logError({
            itemId: "NA",  // itemIdをログに追加
            errorType: 'API_ERROR',
            errorMessage: error.message,
            attemptNumber: 1,  // 任意のリトライ回数を指定可能
            additionalInfo: {
                functionName: 'sendWeeklySalesInfo',
            }
        });
        res.status(500).json({ error: 'Failed to send weekly sales info to Chatwork.' });
    }
}

async function sendProcurementAlertInfo(req, res) {
    const { userId } = req.params;
    const token = process.env.CHATWORK_PROCUREMENT_ALERT_TOKEN;
    const roomId = process.env.CHATWORK_PROCUREMENT_ALERT_ROOM_ID;

    if (!token || !roomId) {
        return res.status(500).json({ error: 'CHATWORK_PROCUREMENT_ALERT_TOKEN and CHATWORK_PROCUREMENT_ALERT_ROOM_ID are required' });
    }

    try {
        const result = await chatworkService.sendProcurementAlertSummary(userId, token, roomId);
        res.status(200).json(result);
    } catch (error) {
        console.error('Error sending procurement alert info to Chatwork:', error.message);

        await logError({
            itemId: 'NA',
            errorType: 'API_ERROR',
            errorMessage: error.message,
            attemptNumber: 1,
            additionalInfo: {
                functionName: 'sendProcurementAlertInfo',
            }
        });
        res.status(500).json({ error: 'Failed to send procurement alert info to Chatwork.' });
    }
}

module.exports = {
    sendWeeklySalesInfo,
    sendProcurementAlertInfo,
};
