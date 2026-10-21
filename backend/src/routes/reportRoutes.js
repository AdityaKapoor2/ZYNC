import express from 'express';
import { verifyToken } from '../middleware/authMiddleware.js';
import { enforceActiveUser } from '../middleware/activeMiddleware.js';
import { createReport } from '../controllers/reportController.js';
import { reportCreationRateLimiter } from '../middleware/rateLimitMiddleware.js';

const router = express.Router();

// All report routes require authentication
router.use(verifyToken);
router.use(enforceActiveUser);

router.post('/', reportCreationRateLimiter, createReport);

export default router;
