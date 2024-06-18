const { createSchedule, getSchedulesByUserId, updateSchedule, deleteSchedule } = require('../models/scheduleModel');

const createNewSchedule = async (schedule) => {
    return await createSchedule(schedule);
};

const fetchSchedulesByUserId = async (userId) => {
    return await getSchedulesByUserId(userId);
};

const modifySchedule = async (id, updates) => {
    return await updateSchedule(id, updates);
};

const removeSchedule = async (id) => {
    return await deleteSchedule(id);
};

module.exports = { createNewSchedule, fetchSchedulesByUserId, modifySchedule, removeSchedule };
