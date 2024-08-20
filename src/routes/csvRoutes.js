const express = require('express');
const multer = require('multer');
const { processCSVUpload } = require('../controllers/csvController');

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

router.post('/upload', upload.single('file'), processCSVUpload);

module.exports = router;
