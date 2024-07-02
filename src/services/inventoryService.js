const { getInventoryUpdateHistoryByUserId } = require('../models/inventoryModel');
const octoparseService = require('./octoparseService');
const itemService = require('./itemService');
const ebayService = require('./ebayService');
const { uploadFileToGoogleDrive } = require('./googleDriveService');
const supabase = require('../supabaseClient');
const path = require('path');
const fs = require('fs'); // ファイルシステムモジュールを追加
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

/**
 * 在庫更新履歴をユーザーIDで取得するサービス関数
 * @param {string} userId - ユーザーID
 * @returns {Promise<object>} - 取得した在庫更新履歴
 */
const fetchInventoryUpdateHistory = async (userId) => {
    return await getInventoryUpdateHistoryByUserId(userId);
};

// 在庫更新履歴を保存
const saveInventoryUpdateSummary = async (octoparseTaskId, userId, ebayUserId, logFileId = '', successCount = 0, failureCount = 0, errorMessage = '', taskDeleteStatus = false) => {
    try {
        // 現在の日時を取得
        const now = new Date();
        // JSTに変換（UTCに9時間を追加）
        const jstDate = new Date(now.getTime() + 9 * 60 * 60 * 1000);
        // ISO 8601形式の文字列を取得
        const jstISOString = jstDate.toISOString().replace('Z', '+09:00');

        const { data, error } = await supabase
            .from('inventory_update_history')
            .insert([
                {
                    octoparse_task_id: octoparseTaskId,
                    user_id: userId,
                    ebay_user_id: ebayUserId,
                    log_file_id: logFileId,
                    success_count: successCount,
                    failure_count: failureCount,
                    update_time: jstISOString,
                    error_message: errorMessage,
                    task_delete_status: taskDeleteStatus
                }
            ]);

        if (error) {
            throw error;
        }
        return data;
    } catch (error) {
        console.error('Error saving inventory update summary:', error.message);
        throw error;
    }
};

// 在庫更新の主要なロジック
const processInventoryUpdate = async (userId, ebayUserId, taskId, folderId) => {
    try {
        console.log("processInventoryUpdate")
        // Octoparseのデータを取得
        const octoparseData = await octoparseService.fetchAllOctoparseData(userId, taskId);

        // 在庫データを照合して更新
        const formattedData = await itemService.processDataAndFetchMatchingItems(octoparseData, ebayUserId);

        // 在庫情報をeBayに送信
        const { results, successCount, failureCount } = await ebayService.updateEbayInventoryTradingAPI(userId, ebayUserId, formattedData, taskId, folderId);

        // 結果をCSVファイルに保存
        const fileName = `inventory_update_results_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
        const filePath = path.join(__dirname, fileName);
        const csvWriter = createCsvWriter({
            path: filePath,
            header: [
                { id: 'itemId', title: 'ItemID' },
                { id: 'stockUrl', title: 'StockUrl' },
                { id: 'stockStatus', title: 'StockStatus' },
                { id: 'quantity', title: 'Quantity' },
                { id: 'status', title: 'Status' },
                { id: 'errorCode', title: 'ErrorCode' },
                { id: 'shortMessage', title: 'ShortMessage' },
                { id: 'longMessage', title: 'LongMessage' }
            ]
        });
        await csvWriter.writeRecords(results);

        // CSVファイルをGoogle Driveにアップロード
        const logFileId = await uploadFileToGoogleDrive(filePath, folderId);

        // task_delete_flgのチェック
        const { data: schedules, error } = await supabase
            .from('inventory_management_schedules')
            .select('task_delete_flg')
            .eq('task_id', taskId)
            .single();

        if (error) {
            throw error;
        }

        let taskDeleteStatus = false;
        if (schedules.task_delete_flg) {
            await octoparseService.deleteOctoparseData(userId, taskId);
            taskDeleteStatus = true;
        }

        // 更新履歴をSupabaseに保存
        await saveInventoryUpdateSummary(taskId, userId, ebayUserId, logFileId, successCount, failureCount, '', taskDeleteStatus);

        console.log('在庫更新が完了しました');

        // CSVファイルを削除
        fs.unlinkSync(filePath);
    } catch (error) {
        console.error('在庫更新処理中にエラーが発生しました:', error);
        // エラーログを保存
        await saveInventoryUpdateSummary(taskId, userId, ebayUserId, '', 0, 0, error.message, false);
    }
};

module.exports = {
    processInventoryUpdate,
    fetchInventoryUpdateHistory
};
