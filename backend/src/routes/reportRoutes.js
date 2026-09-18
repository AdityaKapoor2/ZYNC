import express from 'express';
import { verifyToken } from '../middleware/authMiddleware.js';
import { createReport } from '../controllers/reportController.js';

const router = express.Router();

// All report routes require authentication
router.use(verifyToken);

router.post('/', createReport);

export default router;
