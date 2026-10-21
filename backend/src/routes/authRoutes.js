import express from 'express';
import { verifyAuth } from '../controllers/authController.js';
import { verifyToken } from '../middleware/authMiddleware.js';
import { authRateLimiter, authIpRateLimiter } from '../middleware/rateLimitMiddleware.js';

const router = express.Router();

// POST /api/auth/verify
// 1. authIpRateLimiter (IP-based, 60 req/min): protects against unauthenticated token verification floods
// 2. verifyToken: cryptographically validates Firebase ID token and sets req.user
// 3. authRateLimiter (User-based, 30 req/min): limits verified user accounts from spamming auth/profile provisioning
router.post('/verify', authIpRateLimiter, verifyToken, authRateLimiter, verifyAuth);

export default router;
