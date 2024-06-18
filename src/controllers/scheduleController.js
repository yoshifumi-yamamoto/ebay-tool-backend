const { saveSchedules, getSchedulesByTaskId } = require('../services/scheduleService');

/**
 * スケジュールを取得するコントローラ関数
 * @param {object} req - リクエストオブジェクト
 * @param {object} res - レスポンスオブジェクト
 */
const fetchSchedules = async (req, res) => {
    const { taskId } = req.params;
    console.log("taskId",taskId)
    try {
        const schedules = await getSchedulesByTaskId(taskId);
        res.status(200).json(schedules);
    } catch (error) {
        res.status(500).send('Error fetching schedules');
    }
};

/**
 * スケジュールを保存するコントローラ関数
 * @param {object} req - リクエストオブジェクト
 * @param {object} res - レスポンスオブジェクト
 */
const saveSchedule = async (req, res) => {
    const { taskId, days_of_week, time, user_id } = req.body;
    const scheduleData = { taskId, days_of_week, time };
    try {
        const savedSchedules = await saveSchedules(scheduleData, user_id); // user_idを含めてスケジュールデータを保存
        res.status(200).json(savedSchedules);
    } catch (error) {
        console.error('Error saving schedule:', error); // エラーログを出力
        res.status(500).send('Error saving schedule');
    }
};


module.exports = { fetchSchedules, saveSchedule };
