import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import { connectTestDB, closeTestDB, clearTestDB } from './setup.js';

vi.mock('../src/middleware/authMiddleware.js', () => ({
  verifyToken: (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ message: 'Unauthorized: No token provided' });
    }
    const token = authHeader.split(' ')[1];
    if (token === 'invalid_token') {
      return res.status(401).json({ message: 'Unauthorized: Invalid token' });
    }
    // token acts as the firebaseUid in tests, exactly matching real Firebase auth payload
    req.user = { uid: token };
    next();
  }
}));

import adminRoutes from '../src/routes/adminRoutes.js';
import notificationRoutes from '../src/routes/notificationRoutes.js';
import UserProfile from '../src/models/UserProfile.js';
import Report from '../src/models/Report.js';
import ModerationAction from '../src/models/ModerationAction.js';
import Notification from '../src/models/Notification.js';

const app = express();
app.use(express.json());
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);

describe('Official Moderation Warning & User Notification Flow', () => {
  let superAdmin, warnedUser, otherUser, report;

  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();

    superAdmin = await UserProfile.create({
      firebaseUid: 'uidSuperAdmin',
      displayName: 'Super Admin',
      email: 'admin@zync.gg',
      role: 'super_admin',
      accountStatus: 'active'
    });

    warnedUser = await UserProfile.create({
      firebaseUid: 'uidWarnedUser',
      displayName: 'Warned Player',
      email: 'warned@zync.gg',
      role: 'user',
      accountStatus: 'active'
    });

    otherUser = await UserProfile.create({
      firebaseUid: 'uidOtherUser',
      displayName: 'Other Player',
      email: 'other@zync.gg',
      role: 'user',
      accountStatus: 'active'
    });

    report = await Report.create({
      reporter: otherUser._id,
      reportedUser: warnedUser._id,
      reason: 'Inappropriate messages',
      description: 'Used disrespectful language in post-game chat.',
      status: 'pending',
      evidenceMessages: [
        { senderId: warnedUser._id, text: 'Disrespectful text', timestamp: new Date() }
      ]
    });
  });

  it('1. Issuing a warning creates a ModerationAction', async () => {
    const res = await request(app)
      .post('/api/admin/moderation-actions')
      .set('Authorization', 'Bearer uidSuperAdmin')
      .send({
        affectedUserId: warnedUser._id.toString(),
        actionType: 'warning',
        reason: 'Violation of Community Guidelines regarding respectful chat.',
        relatedReportId: report._id.toString()
      });

    expect(res.status).toBe(201);
    expect(res.body.action).toBeDefined();
    expect(res.body.action.actionType).toBe('warning');
    expect(res.body.action.affectedUser.toString()).toBe(warnedUser._id.toString());

    const savedAction = await ModerationAction.findById(res.body.action._id);
    expect(savedAction).toBeTruthy();
    expect(savedAction.actionType).toBe('warning');
  });

  it('2. The intended user Notification document is created', async () => {
    const res = await request(app)
      .post('/api/admin/moderation-actions')
      .set('Authorization', 'Bearer uidSuperAdmin')
      .send({
        affectedUserId: warnedUser._id.toString(),
        actionType: 'warning',
        reason: 'Unsportsmanlike conduct in lobby',
        relatedReportId: report._id.toString()
      });

    expect(res.status).toBe(201);

    const notifs = await Notification.find({ recipient: warnedUser._id });
    expect(notifs.length).toBe(1);
    expect(notifs[0].title).toBe('Official Moderation Warning');
    expect(notifs[0].message).toContain('Unsportsmanlike conduct in lobby');
    expect(notifs[0].read).toBe(false);
  });

  it('3. The Notification recipient is the correct MongoDB UserProfile _id (not Firebase UID)', async () => {
    await request(app)
      .post('/api/admin/moderation-actions')
      .set('Authorization', 'Bearer uidSuperAdmin')
      .send({
        affectedUserId: warnedUser._id.toString(),
        actionType: 'warning',
        reason: 'Minor toxicity',
        relatedReportId: report._id.toString()
      });

    const notif = await Notification.findOne({ title: 'Official Moderation Warning' });
    expect(notif).toBeTruthy();
    // Must be a valid ObjectId matching MongoDB _id
    expect(mongoose.Types.ObjectId.isValid(notif.recipient)).toBe(true);
    expect(notif.recipient.toString()).toBe(warnedUser._id.toString());
    // Must NOT be the Firebase UID string
    expect(notif.recipient.toString()).not.toBe('uidWarnedUser');
  });

  it('4. The affected user can retrieve the notification through GET /api/notifications', async () => {
    await request(app)
      .post('/api/admin/moderation-actions')
      .set('Authorization', 'Bearer uidSuperAdmin')
      .send({
        affectedUserId: warnedUser._id.toString(),
        actionType: 'warning',
        reason: 'Spamming connection requests',
        relatedReportId: report._id.toString()
      });

    // Request as warnedUser using Firebase UID token resolution
    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', 'Bearer uidWarnedUser');

    expect(res.status).toBe(200);
    expect(res.body.notifications).toBeDefined();
    expect(res.body.notifications.length).toBe(1);
    expect(res.body.notifications[0].title).toBe('Official Moderation Warning');
    expect(res.body.notifications[0].message).toContain('Spamming connection requests');
  });

  it('5. The unread count includes the warning', async () => {
    await request(app)
      .post('/api/admin/moderation-actions')
      .set('Authorization', 'Bearer uidSuperAdmin')
      .send({
        affectedUserId: warnedUser._id.toString(),
        actionType: 'warning',
        reason: 'Verbal warning for griefing',
        relatedReportId: report._id.toString()
      });

    const res = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', 'Bearer uidWarnedUser');

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });

  it('6. Marking the notification as read works', async () => {
    await request(app)
      .post('/api/admin/moderation-actions')
      .set('Authorization', 'Bearer uidSuperAdmin')
      .send({
        affectedUserId: warnedUser._id.toString(),
        actionType: 'warning',
        reason: 'Inappropriate language',
        relatedReportId: report._id.toString()
      });

    const listRes = await request(app)
      .get('/api/notifications')
      .set('Authorization', 'Bearer uidWarnedUser');

    const notifId = listRes.body.notifications[0]._id;

    // Mark as read
    const patchRes = await request(app)
      .patch(`/api/notifications/${notifId}/read`)
      .set('Authorization', 'Bearer uidWarnedUser');

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.read).toBe(true);

    // Verify unread count is now 0
    const countRes = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', 'Bearer uidWarnedUser');

    expect(countRes.status).toBe(200);
    expect(countRes.body.count).toBe(0);
  });

  it('7. A warning does not suspend the user', async () => {
    expect(warnedUser.accountStatus).toBe('active');

    const res = await request(app)
      .post('/api/admin/moderation-actions')
      .set('Authorization', 'Bearer uidSuperAdmin')
      .send({
        affectedUserId: warnedUser._id.toString(),
        actionType: 'warning',
        reason: 'First strike warning',
        relatedReportId: report._id.toString()
      });

    expect(res.status).toBe(201);

    const freshUser = await UserProfile.findById(warnedUser._id);
    expect(freshUser.accountStatus).toBe('active');
  });

  it('8. Other users cannot retrieve the warning', async () => {
    await request(app)
      .post('/api/admin/moderation-actions')
      .set('Authorization', 'Bearer uidSuperAdmin')
      .send({
        affectedUserId: warnedUser._id.toString(),
        actionType: 'warning',
        reason: 'Reported violation',
        relatedReportId: report._id.toString()
      });

    // otherUser checks their notifications
    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', 'Bearer uidOtherUser');

    expect(res.status).toBe(200);
    expect(res.body.notifications.length).toBe(0);

    const countRes = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', 'Bearer uidOtherUser');

    expect(countRes.status).toBe(200);
    expect(countRes.body.count).toBe(0);
  });

  it('9. Normal users cannot create moderation warnings', async () => {
    const res = await request(app)
      .post('/api/admin/moderation-actions')
      .set('Authorization', 'Bearer uidOtherUser')
      .send({
        affectedUserId: warnedUser._id.toString(),
        actionType: 'warning',
        reason: 'Attempted unauthorized warning'
      });

    expect(res.status).toBe(403);

    const count = await ModerationAction.countDocuments({});
    expect(count).toBe(0);

    const notifCount = await Notification.countDocuments({});
    expect(notifCount).toBe(0);
  });

  it('10. Failed moderation actions do not send misleading warning notifications', async () => {
    // Missing required reason -> fails before commit
    const res = await request(app)
      .post('/api/admin/moderation-actions')
      .set('Authorization', 'Bearer uidSuperAdmin')
      .send({
        affectedUserId: warnedUser._id.toString(),
        actionType: 'warning',
        reason: '',
        relatedReportId: report._id.toString()
      });

    expect(res.status).toBe(400);

    const notifs = await Notification.find({});
    expect(notifs.length).toBe(0);

    const actions = await ModerationAction.find({});
    expect(actions.length).toBe(0);
  });

  it('11. Repeated submissions do not create duplicate warnings', async () => {
    // First submission succeeds
    const res1 = await request(app)
      .post('/api/admin/moderation-actions')
      .set('Authorization', 'Bearer uidSuperAdmin')
      .send({
        affectedUserId: warnedUser._id.toString(),
        actionType: 'warning',
        reason: 'First and only warning',
        relatedReportId: report._id.toString()
      });

    expect(res1.status).toBe(201);

    // Immediate second submission for the same report/actionType
    const res2 = await request(app)
      .post('/api/admin/moderation-actions')
      .set('Authorization', 'Bearer uidSuperAdmin')
      .send({
        affectedUserId: warnedUser._id.toString(),
        actionType: 'warning',
        reason: 'First and only warning',
        relatedReportId: report._id.toString()
      });

    expect(res2.status).toBe(409);

    // Verify exactly one action and one notification exist
    const actionCount = await ModerationAction.countDocuments({
      affectedUser: warnedUser._id,
      actionType: 'warning'
    });
    expect(actionCount).toBe(1);

    const notifCount = await Notification.countDocuments({
      recipient: warnedUser._id
    });
    expect(notifCount).toBe(1);
  });

  it('12. Existing moderation transaction and rollback tests continue passing', async () => {
    // Simulate Notification save rejection during transaction
    const notifSaveSpy = vi.spyOn(Notification.prototype, 'save').mockRejectedValueOnce(new Error('Simulated Notification Save Error'));

    const res = await request(app)
      .post('/api/admin/moderation-actions')
      .set('Authorization', 'Bearer uidSuperAdmin')
      .send({
        affectedUserId: warnedUser._id.toString(),
        actionType: 'warning',
        reason: 'Rollback test warning',
        relatedReportId: report._id.toString()
      });

    expect(res.status).toBe(500);

    // ModerationAction must NOT have been saved
    const actions = await ModerationAction.find({ reason: 'Rollback test warning' });
    expect(actions.length).toBe(0);

    // Notification must NOT have been saved
    const notifs = await Notification.find({ message: /Rollback test warning/ });
    expect(notifs.length).toBe(0);

    // Report status should NOT have been updated to resolved
    const freshReport = await Report.findById(report._id);
    expect(freshReport.status).toBe('pending');

    notifSaveSpy.mockRestore();
  });

  it('13. Firebase UID to MongoDB _id resolution works in the real authentication flow', async () => {
    // Admin request with Bearer uidSuperAdmin resolves to superAdmin._id
    // Affected user with Bearer uidWarnedUser resolves to warnedUser._id
    const res = await request(app)
      .post('/api/admin/moderation-actions')
      .set('Authorization', 'Bearer uidSuperAdmin')
      .send({
        affectedUserId: warnedUser._id.toString(),
        actionType: 'warning',
        reason: 'Testing UID resolution',
        relatedReportId: report._id.toString()
      });

    expect(res.status).toBe(201);
    expect(res.body.action.admin.toString()).toBe(superAdmin._id.toString());

    // When warnedUser accesses /api/notifications using their Firebase UID token:
    const notifRes = await request(app)
      .get('/api/notifications')
      .set('Authorization', 'Bearer uidWarnedUser');

    expect(notifRes.status).toBe(200);
    expect(notifRes.body.notifications.length).toBe(1);
    expect(notifRes.body.notifications[0].recipient.toString()).toBe(warnedUser._id.toString());
  });
});
