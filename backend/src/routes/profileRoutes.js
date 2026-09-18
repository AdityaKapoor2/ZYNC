import express from 'express';
import { getProfile, updateProfile, getPublicProfile } from '../controllers/profileController.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply verifyToken middleware to all profile routes
router.use(verifyToken);

// GET /api/profiles/me
router.get('/me', getProfile);

// PUT /api/profiles/me
router.put('/me', updateProfile);
// GET /api/profiles/user/:id
router.get('/user/:id', getPublicProfile);

export default router;
