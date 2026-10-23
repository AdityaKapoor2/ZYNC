import express from 'express';
import { verifyToken } from '../middleware/authMiddleware.js';
import { verifySuperAdmin } from '../middleware/adminMiddleware.js';
import { 
  supportCreationRateLimiter,
  supportMessageRateLimiter
} from '../middleware/rateLimitMiddleware.js';
import { 
  submitAppeal,
  createTicket,
  getUserTickets,
  getTicketDetails,
  replyTicket,
  reopenTicket,
  getStaffTickets,
  updateTicketStaffMeta,
  addInternalNote
} from '../controllers/supportController.js';

const router = express.Router();

// Base middleware for all support routes is authentication.
// Note: Support routes do NOT use enforceActiveUser so suspended users can submit appeals/tickets.
router.use(verifyToken);

// 1. Legacy appeal route (preserved)
router.post('/appeal', supportCreationRateLimiter, submitAppeal);

// 2. User Support Ticket routes (Active and Suspended users)
router.post('/tickets', supportCreationRateLimiter, createTicket);
router.get('/tickets', getUserTickets);
router.get('/tickets/:id', getTicketDetails);
router.post('/tickets/:id/reply', supportMessageRateLimiter, replyTicket);
router.post('/tickets/:id/reopen', reopenTicket);
router.patch('/tickets/:id/reopen', reopenTicket);


// 3. Staff/Admin Support Ticket routes (Protected with verifySuperAdmin)
router.get('/admin/tickets', verifySuperAdmin, getStaffTickets);
router.patch('/admin/tickets/:id', verifySuperAdmin, updateTicketStaffMeta);
router.post('/admin/tickets/:id/notes', verifySuperAdmin, addInternalNote);

export default router;
