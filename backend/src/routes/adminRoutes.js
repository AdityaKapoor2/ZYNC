import express from 'express';
import { 
  getUsers, 
  getUserDetails, 
  updateUserStatus,
  getReports,
  getReportDetails,
  updateReportStatus,
  messageReportUser,
  createModerationAction,
  getModerationActions,
  getModerationActionDetails
} from '../controllers/adminController.js';
import { verifyToken } from '../middleware/authMiddleware.js';
import { verifySuperAdmin } from '../middleware/adminMiddleware.js';

const router = express.Router();

router.use(verifyToken);
router.use(verifySuperAdmin);

router.get('/users', getUsers);
router.get('/users/:id', getUserDetails);
router.put('/users/:id/status', updateUserStatus);

router.get('/reports', getReports);
router.get('/reports/:id', getReportDetails);
router.patch('/reports/:id/status', updateReportStatus);
router.post('/reports/:id/message', messageReportUser);

router.post('/moderation-actions', createModerationAction);
router.get('/moderation-actions', getModerationActions);
router.get('/moderation-actions/:id', getModerationActionDetails);

import {
  createAdminNotification,
  getAdminNotificationHistory
} from '../controllers/adminNotificationController.js';

router.post('/notifications', createAdminNotification);
router.get('/notifications', getAdminNotificationHistory);

export default router;
