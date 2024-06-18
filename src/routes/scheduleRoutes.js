const express = require('express');
const { addSchedule, getSchedules, updateScheduleById, deleteScheduleById } = require('../controllers/scheduleController');

const router = express.Router();

router.post('/schedules', addSchedule);
router.get('/schedules/:userId', getSchedules);
router.put('/schedules/:id', updateScheduleById);
router.delete('/schedules/:id', deleteScheduleById);

module.exports = router;
