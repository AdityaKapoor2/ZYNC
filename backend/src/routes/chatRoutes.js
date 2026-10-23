import express from 'express';

import { verifyToken } from '../middleware/authMiddleware.js';

import {
  getConversations,
  getInbox,
  getOrCreateConversation,
  getMessages,
  sendMessage,
  markConversationAsRead
} from '../controllers/chatController.js';
import { messageSendRateLimiter } from '../middleware/rateLimitMiddleware.js';

const router = express.Router();

// All chat routes require authentication
router.use(verifyToken);

router.get('/conversations', getConversations);
router.get('/inbox', getInbox);

router.post('/conversations/:targetUserId', getOrCreateConversation);

router.get('/conversations/:conversationId/messages', getMessages);

router.post('/conversations/:conversationId/messages', messageSendRateLimiter, sendMessage);

router.post('/conversations/:conversationId/read', markConversationAsRead);
router.patch('/conversations/:conversationId/read', markConversationAsRead);

export default router;