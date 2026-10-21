import express from 'express';
import { getMatches, getMatchExplanation } from '../controllers/matchController.js';
import { verifyToken } from '../middleware/authMiddleware.js';
import { enforceActiveUser } from '../middleware/activeMiddleware.js';
import { matchExplanationRateLimiter } from '../middleware/rateLimitMiddleware.js';

const router = express.Router();

router.get('/', verifyToken, enforceActiveUser, getMatches);
router.get('/:targetUserId/explanation', verifyToken, enforceActiveUser, matchExplanationRateLimiter, getMatchExplanation);

export default router;
