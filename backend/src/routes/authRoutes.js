import express from 'express';
import { verifyAuth } from '../controllers/authController.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = express.Router();

// POST /api/auth/verify
router.post('/verify', verifyToken, verifyAuth);

export default router;
