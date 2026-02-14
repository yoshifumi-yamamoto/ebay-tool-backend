const express = require('express');
const multer = require('multer');
const router = express.Router();
const employeeController = require('../controllers/employeeController');

const storage = multer.memoryStorage();
const upload = multer({ storage });

router.get('/csv', employeeController.downloadEmployeesCsv);
router.post('/csv', upload.single('file'), employeeController.uploadEmployeesCsv);
router.get('/', employeeController.listEmployees);
router.post('/', employeeController.createEmployee);
router.put('/:id', employeeController.updateEmployee);
router.delete('/:id', employeeController.deleteEmployee);

module.exports = router;
