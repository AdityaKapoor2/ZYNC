import express from 'express';
import { setOnline, setOffline, getPresence } from '../controllers/presenceController.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(verifyToken);

router.post('/online', setOnline);
router.post('/offline', setOffline);
router.get('/me', getPresence);

export default router;
