const { createNewSchedule, fetchSchedulesByUserId, modifySchedule, removeSchedule } = require('../services/scheduleService');

const addSchedule = async (req, res) => {
    try {
        const schedule = req.body;
        const data = await createNewSchedule(schedule);
        res.status(201).json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const getSchedules = async (req, res) => {
    try {
        const { userId } = req.params;
        const data = await fetchSchedulesByUserId(userId);
        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const updateScheduleById = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        const data = await modifySchedule(id, updates);
        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const deleteScheduleById = async (req, res) => {
    try {
        const { id } = req.params;
        const data = await removeSchedule(id);
        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

module.exports = { addSchedule, getSchedules, updateScheduleById, deleteScheduleById };
