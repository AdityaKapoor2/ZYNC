import express from 'express';
import { 
  sendRequest, 
  getRequests, 
  getSentRequests, 
  acceptRequest, 
  rejectRequest, 
  getConnections 
} from '../controllers/connectionController.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply verifyToken middleware to all connection routes
router.use(verifyToken);

// GET /api/connections
// Get accepted connections
router.get('/', getConnections);

// GET /api/connections/requests
// Get incoming pending requests
router.get('/requests', getRequests);

// GET /api/connections/sent
// Get outgoing sent requests
router.get('/sent', getSentRequests);

// POST /api/connections/request/:userId
// Send a connection request to another user
router.post('/request/:userId', sendRequest);

// PUT /api/connections/:connectionId/accept
// Accept an incoming request
router.put('/:connectionId/accept', acceptRequest);

// PUT /api/connections/:connectionId/reject
// Reject an incoming request
router.put('/:connectionId/reject', rejectRequest);

export default router;
