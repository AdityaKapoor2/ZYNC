import express from 'express';

import { verifyToken } from '../middleware/authMiddleware.js';

import {
  getConversations,
  getOrCreateConversation,
  getMessages,
  sendMessage
} from '../controllers/chatController.js';

const router = express.Router();

// All chat routes require authentication
router.use(verifyToken);

router.get('/conversations', getConversations);

router.post('/conversations/:targetUserId', getOrCreateConversation);

router.get('/conversations/:conversationId/messages', getMessages);

router.post('/conversations/:conversationId/messages', sendMessage);

export default router;