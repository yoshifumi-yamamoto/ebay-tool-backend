// // scheduler.js
// const { CronJob } = require('cron');
// const { getAllSchedules } = require('./services/scheduleService');
// const { processInventoryUpdate } = require('./services/inventoryService');
// require('dotenv').config();

// let jobs = [];

// const clearJobs = () => {
//     jobs.forEach(job => job.stop());
//     jobs = [];
// };

// const scheduleInventoryUpdates = async () => {
//     if (process.env.ENABLE_SCHEDULER !== 'true') {
//         console.log('Scheduler is disabled');
//         return;
//     } else {
//         console.log("Scheduler is enabled");
//     }

//     const schedules = await getAllSchedules();

//     clearJobs();

//     schedules.forEach(schedule => {
//         const { days_of_week, time_of_day, task_id, user_id, ebay_user_id, folder_id } = schedule;

//         const [hour, minute] = time_of_day.split(':');

//         days_of_week.forEach(day => {
//             const cronDay = day + 1;
//             const cronTime = `${minute} ${hour} * * ${cronDay}`;

//             const job = new CronJob(cronTime, async () => {
//                 try {
//                     console.log(`Running inventory update for task ${task_id} on day ${day} at ${time_of_day}`);
//                     await processInventoryUpdate(user_id, ebay_user_id, task_id, folder_id);
//                 } catch (error) {
//                     console.error('Error running scheduled inventory update:', error);
//                 }
//             }, null, true, 'Asia/Tokyo');

//             jobs.push(job);
//         });
//     });
// };

// module.exports = { scheduleInventoryUpdates, clearJobs };

const { CronJob } = require('cron');
const { getAllSchedules } = require('./services/scheduleService');
const { processInventoryUpdate } = require('./services/inventoryService');
require('dotenv').config();

/**
 * スケジュールに基づいて在庫を更新する関数
 */
const scheduleInventoryUpdates = async () => {
    if (process.env.ENABLE_SCHEDULER !== 'true') {
        console.log('Scheduler is disabled');
        return;
    } else {
        console.log("waiting...");
    }

    const schedules = await getAllSchedules();

    schedules.forEach(schedule => {
        const { days_of_week, time_of_day, task_id, user_id, ebay_user_id, folder_id } = schedule;

        const [hour, minute] = time_of_day.split(':');

        days_of_week.forEach(day => {
            // cronの曜日は0（日曜日）から6（土曜日）なので、days_of_weekが0（月曜日）の場合は1に変換
            const cronDay = day + 1;

            const cronTime = `${minute} ${hour} * * ${cronDay}`;

            new CronJob(cronTime, async () => {
                try {
                    console.log(`Running inventory update for task ${task_id} on day ${day} at ${time_of_day}`);
                    await processInventoryUpdate(user_id, ebay_user_id, task_id, folder_id);
                } catch (error) {
                    console.error('Error running scheduled inventory update:', error);
                }
            }, null, true, 'Asia/Tokyo');
        });
    });
};

module.exports = { scheduleInventoryUpdates };
