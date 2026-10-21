import express from 'express';
import { createRating } from '../controllers/ratingController.js';
import { verifyToken } from '../middleware/authMiddleware.js';
import { enforceActiveUser } from '../middleware/activeMiddleware.js';

const router = express.Router();

router.use(verifyToken);
router.use(enforceActiveUser);
router.post('/', createRating);

export default router;
