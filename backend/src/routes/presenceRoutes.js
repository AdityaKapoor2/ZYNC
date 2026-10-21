import express from 'express';
import { setOnline, setOffline, getPresence } from '../controllers/presenceController.js';
import { verifyToken } from '../middleware/authMiddleware.js';
import { enforceActiveUser } from '../middleware/activeMiddleware.js';

const router = express.Router();

router.use(verifyToken);

router.post('/online', enforceActiveUser, setOnline);
router.post('/offline', enforceActiveUser, setOffline);
router.get('/me', getPresence);

export default router;
