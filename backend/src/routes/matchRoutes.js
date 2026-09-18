import express from 'express';
import { getMatches } from '../controllers/matchController.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', verifyToken, getMatches);

export default router;
