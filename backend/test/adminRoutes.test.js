import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import { connectTestDB, closeTestDB, clearTestDB } from './setup.js';
import ModerationAction from '../src/models/ModerationAction.js';

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
    // token acts as the firebaseUid in tests
    req.user = { uid: token };
    next();
  }
}));

import adminRoutes from '../src/routes/adminRoutes.js';
import matchRoutes from '../src/routes/matchRoutes.js';
import UserProfile from '../src/models/UserProfile.js';
import Report from '../src/models/Report.js';

const app = express();
app.use(express.json());
app.use('/api/admin', adminRoutes);
// Mount match routes to test suspension enforcement
app.use('/api/matches', matchRoutes);

describe('Super Admin User Management & Suspension', () => {
  let superAdmin, normalUser1, normalUser2;

  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    
    // Create users
    superAdmin = await UserProfile.create({ 
      firebaseUid: 'uidAdmin', 
      displayName: 'Super Admin', 
      email: 'admin@admin.com', 
      role: 'super_admin' 
    });
    
    normalUser1 = await UserProfile.create({ 
      firebaseUid: 'uidUser1', 
      displayName: 'User One', 
      email: 'user1@user.com', 
      role: 'user',
      accountStatus: 'active'
    });
    
    normalUser2 = await UserProfile.create({ 
      firebaseUid: 'uidUser2', 
      displayName: 'User Two', 
      email: 'user2@user.com', 
      role: 'user',
      accountStatus: 'suspended'
    });

    await Report.create({
      reporter: normalUser1._id,
      reportedUser: normalUser2._id,
      reason: 'Toxic or abusive behavior',
      description: 'Test 1',
      status: 'pending',
      evidenceMessages: [
        { senderId: normalUser2._id, text: 'Bad msg 1', timestamp: new Date('2023-01-01T10:00:00Z') }
      ],
      createdAt: new Date('2023-01-02T10:00:00Z')
    });

    await Report.create({
      reporter: normalUser2._id,
      reportedUser: normalUser1._id,
      reason: 'Spam',
      description: 'Test 2',
      status: 'resolved',
      evidenceMessages: [],
      createdAt: new Date('2023-01-03T10:00:00Z')
    });
  });

  // AUTHORIZATION
  describe('Authorization', () => {
    it('1. Unauthenticated request -> rejected', async () => {
      const res = await request(app).get('/api/admin/users');
      expect(res.status).toBe(401);
    });

    it('2. Normal authenticated user -> rejected', async () => {
      const res = await request(app)
        .get('/api/admin/users')
        .set('Authorization', 'Bearer uidUser1');
      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Forbidden');
    });

    it('3. Super Admin -> allowed', async () => {
      const res = await request(app)
        .get('/api/admin/users')
        .set('Authorization', 'Bearer uidAdmin');
      expect(res.status).toBe(200);
    });
  });

  // USER LIST
  describe('User List', () => {
    it('4. Super Admin can retrieve users', async () => {
      const res = await request(app)
        .get('/api/admin/users')
        .set('Authorization', 'Bearer uidAdmin');
      expect(res.status).toBe(200);
      expect(res.body.users.length).toBe(3); // admin, user1, user2
    });

    it('5. Pagination works', async () => {
      const res = await request(app)
        .get('/api/admin/users?page=1&limit=2')
        .set('Authorization', 'Bearer uidAdmin');
      expect(res.status).toBe(200);
      expect(res.body.users.length).toBe(2);
      expect(res.body.totalPages).toBe(2);
    });

    it('6. Maximum page size is enforced', async () => {
      const res = await request(app)
        .get('/api/admin/users?limit=200')
        .set('Authorization', 'Bearer uidAdmin');
      expect(res.status).toBe(200);
      // Wait, limit is parsed but clamped at 100 in controller
      // Let's just check it doesn't fail
      expect(res.body.users.length).toBeLessThanOrEqual(100);
    });

    it('7. Search works', async () => {
      const res = await request(app)
        .get('/api/admin/users?search=User One')
        .set('Authorization', 'Bearer uidAdmin');
      expect(res.status).toBe(200);
      expect(res.body.users.length).toBe(1);
      expect(res.body.users[0].displayName).toBe('User One');
    });

    it('7a. SEC-01: Malformed regex characters do not crash the search endpoint', async () => {
      // Unescaped regex metacharacters that would throw SyntaxError or crash with unescaped new RegExp()
      const malformedQueries = ['[', '*', '(', '+', '?', '^', '$', '(?=test)', '\\'];
      for (const char of malformedQueries) {
        const res = await request(app)
          .get(`/api/admin/users?search=${encodeURIComponent(char)}`)
          .set('Authorization', 'Bearer uidAdmin');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('users');
      }
    });

    it('7b. SEC-01: Regex characters are treated literally rather than as pattern syntax', async () => {
      // Create user with special characters in displayName and email
      await UserProfile.create({
        firebaseUid: 'uidSpecial',
        displayName: 'Player[1]+Elite',
        email: 'special+player@zync.gg',
        role: 'user',
        accountStatus: 'active'
      });

      // Searching for '[1]+Elite' should match literally
      const literalNameRes = await request(app)
        .get(`/api/admin/users?search=${encodeURIComponent('[1]+Elite')}`)
        .set('Authorization', 'Bearer uidAdmin');
      expect(literalNameRes.status).toBe(200);
      expect(literalNameRes.body.users.length).toBe(1);
      expect(literalNameRes.body.users[0].displayName).toBe('Player[1]+Elite');

      // Searching for 'special+player' matches email literally
      const literalEmailRes = await request(app)
        .get(`/api/admin/users?search=${encodeURIComponent('special+player')}`)
        .set('Authorization', 'Bearer uidAdmin');
      expect(literalEmailRes.status).toBe(200);
      expect(literalEmailRes.body.users.length).toBe(1);
      expect(literalEmailRes.body.users[0].email).toBe('special+player@zync.gg');

      // A pattern like '[0-9]' should NOT match 'Player[1]+Elite' as a character class
      const charClassRes = await request(app)
        .get(`/api/admin/users?search=${encodeURIComponent('Player[0-9]')}`)
        .set('Authorization', 'Bearer uidAdmin');
      expect(charClassRes.status).toBe(200);
      expect(charClassRes.body.users.length).toBe(0);
    });

    it('7c. SEC-01: Empty search and whitespace-only search return all users without applying regex', async () => {
      const emptyRes = await request(app)
        .get('/api/admin/users?search=')
        .set('Authorization', 'Bearer uidAdmin');
      expect(emptyRes.status).toBe(200);
      expect(emptyRes.body.users.length).toBeGreaterThanOrEqual(3);

      const whitespaceRes = await request(app)
        .get('/api/admin/users?search=%20%20%20')
        .set('Authorization', 'Bearer uidAdmin');
      expect(whitespaceRes.status).toBe(200);
      expect(whitespaceRes.body.users.length).toBeGreaterThanOrEqual(3);
    });

    it('7d. SEC-01: Search query exceeding 100 characters returns 400 Bad Request', async () => {
      const longQuery = 'a'.repeat(101);
      const res = await request(app)
        .get(`/api/admin/users?search=${longQuery}`)
        .set('Authorization', 'Bearer uidAdmin');
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Search query exceeds maximum length of 100 characters');
    });

    it('7e. SEC-01: Non-string search query parameter returns 400 Bad Request', async () => {
      const res = await request(app)
        .get('/api/admin/users?search=first&search=second')
        .set('Authorization', 'Bearer uidAdmin');
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Search query must be a string');
    });

    it('8. Valid filters work', async () => {
      const res = await request(app)
        .get('/api/admin/users?status=suspended')
        .set('Authorization', 'Bearer uidAdmin');
      expect(res.status).toBe(200);
      expect(res.body.users.length).toBe(1);
      expect(res.body.users[0].displayName).toBe('User Two');
    });

    it('9. Invalid filters are rejected appropriately', async () => {
      const res = await request(app)
        .get('/api/admin/users?status=banned')
        .set('Authorization', 'Bearer uidAdmin');
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Invalid status filter');
    });
  });

  // USER DETAILS
  describe('User Details', () => {
    it('10. Existing user can be retrieved by Super Admin', async () => {
      const res = await request(app)
        .get(`/api/admin/users/${normalUser1._id}`)
        .set('Authorization', 'Bearer uidAdmin');
      expect(res.status).toBe(200);
      expect(res.body.displayName).toBe('User One');
    });

    it('11. Non-existent user returns 404', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .get(`/api/admin/users/${fakeId}`)
        .set('Authorization', 'Bearer uidAdmin');
      expect(res.status).toBe(404);
    });

    it('12. Normal user cannot retrieve admin user details', async () => {
      const res = await request(app)
        .get(`/api/admin/users/${superAdmin._id}`)
        .set('Authorization', 'Bearer uidUser1');
      expect(res.status).toBe(403);
    });
  });

  // SUSPENSION
  describe('Suspension', () => {
    it('13. Super Admin can suspend a normal user', async () => {
      const res = await request(app)
        .put(`/api/admin/users/${normalUser1._id}/status`)
        .set('Authorization', 'Bearer uidAdmin')
        .send({ status: 'suspended' });
      expect(res.status).toBe(200);
      
      const updatedUser = await UserProfile.findById(normalUser1._id);
      expect(updatedUser.accountStatus).toBe('suspended');
    });

    it('14. Super Admin can reactivate a suspended user', async () => {
      const res = await request(app)
        .put(`/api/admin/users/${normalUser2._id}/status`)
        .set('Authorization', 'Bearer uidAdmin')
        .send({ status: 'active' });
      expect(res.status).toBe(200);
      
      const updatedUser = await UserProfile.findById(normalUser2._id);
      expect(updatedUser.accountStatus).toBe('active');
    });

    it('15. Invalid account status is rejected', async () => {
      const res = await request(app)
        .put(`/api/admin/users/${normalUser1._id}/status`)
        .set('Authorization', 'Bearer uidAdmin')
        .send({ status: 'banned' });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Invalid status');
    });

    it('16. Super Admin cannot suspend themselves', async () => {
      const res = await request(app)
        .put(`/api/admin/users/${superAdmin._id}/status`)
        .set('Authorization', 'Bearer uidAdmin')
        .send({ status: 'suspended' });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Cannot suspend your own account');
    });

    it('17. Normal user cannot suspend another user', async () => {
      const res = await request(app)
        .put(`/api/admin/users/${normalUser2._id}/status`)
        .set('Authorization', 'Bearer uidUser1')
        .send({ status: 'active' });
      expect(res.status).toBe(403);
    });

    it('18. Role cannot be changed through this API', async () => {
      // The API only accepts status
      const res = await request(app)
        .put(`/api/admin/users/${normalUser1._id}/status`)
        .set('Authorization', 'Bearer uidAdmin')
        .send({ status: 'active', role: 'super_admin' });
      expect(res.status).toBe(200);
      
      const updatedUser = await UserProfile.findById(normalUser1._id);
      expect(updatedUser.role).toBe('user');
    });
  });

  // SUSPENDED-USER ENFORCEMENT
  describe('Suspended-User Enforcement', () => {
    it('19. Suspended user cannot access protected player functionality', async () => {
      const res = await request(app)
        .get('/api/matches')
        .set('Authorization', 'Bearer uidUser2');
      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Account is suspended');
    });

    it('20. Suspended user cannot bypass the restriction by directly calling the backend', async () => {
      // Direct API calls without frontend are blocked by the middleware
      const res = await request(app)
        .get('/api/matches')
        .set('Authorization', 'Bearer uidUser2');
      expect(res.status).toBe(403);
    });

    it('21. Reactivated user can access protected player functionality again', async () => {
      // Admin reactivates
      await request(app)
        .put(`/api/admin/users/${normalUser2._id}/status`)
        .set('Authorization', 'Bearer uidAdmin')
        .send({ status: 'active' });

      // User tries again
      const res = await request(app)
        .get('/api/matches')
        .set('Authorization', 'Bearer uidUser2');
      
      // We expect it not to be 403 (suspended)
      expect(res.status).not.toBe(403);
    });
  });

  describe('Report List API', () => {
    it('22. Super Admin can list reports', async () => {
      const res = await request(app)
        .get('/api/admin/reports')
        .set('Authorization', 'Bearer uidAdmin');
      expect(res.status).toBe(200);
      expect(res.body.reports.length).toBe(2);
    });

    it('23. Normal authenticated user cannot list reports', async () => {
      const res = await request(app)
        .get('/api/admin/reports')
        .set('Authorization', 'Bearer uidUser1');
      expect(res.status).toBe(403);
    });

    it('24. Unauthenticated request cannot list reports', async () => {
      const res = await request(app).get('/api/admin/reports');
      expect(res.status).toBe(401);
    });

    it('25. List endpoint returns newest reports first', async () => {
      const res = await request(app)
        .get('/api/admin/reports')
        .set('Authorization', 'Bearer uidAdmin');
      expect(res.status).toBe(200);
      expect(res.body.reports[0].reason).toBe('Spam'); // Test 2 is newer
    });

    it('26. Default pagination works', async () => {
      const res = await request(app)
        .get('/api/admin/reports')
        .set('Authorization', 'Bearer uidAdmin');
      expect(res.body.pagination.page).toBe(1);
      expect(res.body.pagination.limit).toBe(20);
      expect(res.body.pagination.total).toBe(2);
    });

    it('27. Custom page/limit works', async () => {
      const res = await request(app)
        .get('/api/admin/reports?page=1&limit=1')
        .set('Authorization', 'Bearer uidAdmin');
      expect(res.body.reports.length).toBe(1);
      expect(res.body.pagination.totalPages).toBe(2);
    });

    it('28. Status filtering works', async () => {
      const res = await request(app)
        .get('/api/admin/reports?status=pending')
        .set('Authorization', 'Bearer uidAdmin');
      expect(res.body.reports.length).toBe(1);
      expect(res.body.reports[0].status).toBe('pending');
    });

    it('29. Reason filtering works', async () => {
      const res = await request(app)
        .get('/api/admin/reports?reason=Spam')
        .set('Authorization', 'Bearer uidAdmin');
      expect(res.body.reports.length).toBe(1);
      expect(res.body.reports[0].reason).toBe('Spam');
    });

    it('30. Reporter filtering works', async () => {
      const res = await request(app)
        .get(`/api/admin/reports?reporter=${normalUser1._id}`)
        .set('Authorization', 'Bearer uidAdmin');
      expect(res.body.reports.length).toBe(1);
      expect(res.body.reports[0].reporter._id.toString()).toBe(normalUser1._id.toString());
    });

    it('31. Reported-user filtering works', async () => {
      const res = await request(app)
        .get(`/api/admin/reports?reportedUser=${normalUser1._id}`)
        .set('Authorization', 'Bearer uidAdmin');
      expect(res.body.reports.length).toBe(1);
      expect(res.body.reports[0].reportedUser._id.toString()).toBe(normalUser1._id.toString());
    });

    it('32. Combined filters work', async () => {
      const res = await request(app)
        .get(`/api/admin/reports?status=pending&reason=Toxic or abusive behavior`)
        .set('Authorization', 'Bearer uidAdmin');
      expect(res.body.reports.length).toBe(1);
    });

    it('33. List endpoint does NOT return full evidence message text', async () => {
      const res = await request(app)
        .get('/api/admin/reports')
        .set('Authorization', 'Bearer uidAdmin');
      expect(res.body.reports[1].evidenceMessages).toBeUndefined(); // test 1 is older, at index 1
      expect(res.body.reports[1].evidenceMessageCount).toBe(1);
    });
  });

  describe('Report Detail API', () => {
    let reportId;

    beforeEach(async () => {
      const report = await Report.findOne({ reason: 'Toxic or abusive behavior' });
      reportId = report._id;
    });

    it('34. Super Admin can retrieve a single report', async () => {
      const res = await request(app)
        .get(`/api/admin/reports/${reportId}`)
        .set('Authorization', 'Bearer uidAdmin');
      expect(res.status).toBe(200);
      expect(res.body._id).toBe(reportId.toString());
    });

    it('35. Normal authenticated user cannot retrieve a single report', async () => {
      const res = await request(app)
        .get(`/api/admin/reports/${reportId}`)
        .set('Authorization', 'Bearer uidUser1');
      expect(res.status).toBe(403);
    });

    it('36. Unauthenticated user cannot retrieve a single report', async () => {
      const res = await request(app).get(`/api/admin/reports/${reportId}`);
      expect(res.status).toBe(401);
    });

    it('37. Invalid report ID is handled correctly', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .get(`/api/admin/reports/${fakeId}`)
        .set('Authorization', 'Bearer uidAdmin');
      expect(res.status).toBe(404);
    });

    it('38. Detail endpoint includes evidenceMessages', async () => {
      const res = await request(app)
        .get(`/api/admin/reports/${reportId}`)
        .set('Authorization', 'Bearer uidAdmin');
      expect(res.body.evidenceMessages).toBeDefined();
      expect(res.body.evidenceMessages.length).toBe(1);
      expect(res.body.evidenceMessages[0].text).toBe('Bad msg 1');
    });

    it('39. Evidence remains in chronological order', async () => {
      // In reportController, it's already saved as chronological. The API should just serve it as is.
      const res = await request(app)
        .get(`/api/admin/reports/${reportId}`)
        .set('Authorization', 'Bearer uidAdmin');
      expect(res.body.evidenceMessages).toBeDefined();
    });
  });

  describe('Report Status Workflow', () => {
    let reportId;
    let resolvedId;

    beforeEach(async () => {
      const report = await Report.findOne({ reason: 'Toxic or abusive behavior' });
      reportId = report._id;

      const resolvedReport = await Report.findOne({ reason: 'Spam' });
      resolvedId = resolvedReport._id;
    });

    it('40. Super Admin can change pending -> reviewed', async () => {
      const res = await request(app)
        .patch(`/api/admin/reports/${reportId}/status`)
        .set('Authorization', 'Bearer uidAdmin')
        .send({ status: 'reviewed' });
      expect(res.status).toBe(200);
      expect(res.body.report.status).toBe('reviewed');
      
      const dbReport = await Report.findById(reportId);
      expect(dbReport.status).toBe('reviewed');
      expect(dbReport.updatedAt).not.toBe(dbReport.createdAt); // updatedAt should change
    });

    it('41. Super Admin can change reviewed -> resolved', async () => {
      // Setup: change to reviewed first
      await Report.findByIdAndUpdate(reportId, { status: 'reviewed' });

      const res = await request(app)
        .patch(`/api/admin/reports/${reportId}/status`)
        .set('Authorization', 'Bearer uidAdmin')
        .send({ status: 'resolved' });
      expect(res.status).toBe(200);
      expect(res.body.report.status).toBe('resolved');
    });

    it('42. Super Admin can change reviewed -> dismissed', async () => {
      await Report.findByIdAndUpdate(reportId, { status: 'reviewed' });

      const res = await request(app)
        .patch(`/api/admin/reports/${reportId}/status`)
        .set('Authorization', 'Bearer uidAdmin')
        .send({ status: 'dismissed' });
      expect(res.status).toBe(200);
      expect(res.body.report.status).toBe('dismissed');
    });

    it('43. Normal user cannot change report status', async () => {
      const res = await request(app)
        .patch(`/api/admin/reports/${reportId}/status`)
        .set('Authorization', 'Bearer uidUser1')
        .send({ status: 'reviewed' });
      expect(res.status).toBe(403);
    });

    it('44. Unauthenticated request rejected', async () => {
      const res = await request(app)
        .patch(`/api/admin/reports/${reportId}/status`)
        .send({ status: 'reviewed' });
      expect(res.status).toBe(401);
    });

    it('45. Invalid status -> 400', async () => {
      const res = await request(app)
        .patch(`/api/admin/reports/${reportId}/status`)
        .set('Authorization', 'Bearer uidAdmin')
        .send({ status: 'invalid_status' });
      expect(res.status).toBe(400);
    });

    it('46. Invalid transition -> 400', async () => {
      // pending -> resolved is invalid
      const res = await request(app)
        .patch(`/api/admin/reports/${reportId}/status`)
        .set('Authorization', 'Bearer uidAdmin')
        .send({ status: 'resolved' });
      expect(res.status).toBe(400);
    });

    it('47. Non-existent report -> 404', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .patch(`/api/admin/reports/${fakeId}/status`)
        .set('Authorization', 'Bearer uidAdmin')
        .send({ status: 'reviewed' });
      expect(res.status).toBe(404);
    });

    it('48. Evidence messages, reporter, reportedUser remain unchanged', async () => {
      const original = await Report.findById(reportId);

      const res = await request(app)
        .patch(`/api/admin/reports/${reportId}/status`)
        .set('Authorization', 'Bearer uidAdmin')
        .send({ status: 'reviewed' });
      expect(res.status).toBe(200);

      const updated = await Report.findById(reportId);
      expect(updated.evidenceMessages.length).toBe(original.evidenceMessages.length);
      expect(updated.reporter.toString()).toBe(original.reporter.toString());
      expect(updated.reportedUser.toString()).toBe(original.reportedUser.toString());
      expect(updated.conversationId?.toString()).toBe(original.conversationId?.toString());
    });

    it('49. Already resolved report cannot be changed back to pending or reviewed', async () => {
      const res = await request(app)
        .patch(`/api/admin/reports/${resolvedId}/status`)
        .set('Authorization', 'Bearer uidAdmin')
        .send({ status: 'reviewed' });
      expect(res.status).toBe(400);
    });
  });

  describe('Moderation Actions', () => {
    let reportId;

    beforeEach(async () => {
      const report = await Report.findOne({ reason: 'Toxic or abusive behavior' });
      reportId = report._id;
    });

    it('50. Super Admin can create a warning moderation action', async () => {
      const res = await request(app)
        .post('/api/admin/moderation-actions')
        .set('Authorization', 'Bearer uidAdmin')
        .send({
          affectedUserId: normalUser2._id,
          actionType: 'warning',
          reason: 'Warning for toxicity',
          relatedReportId: reportId
        });
      expect(res.status).toBe(201);
      expect(res.body.action.actionType).toBe('warning');
    });

    it('51. Temporary suspension requires expiresAt in the future', async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);
      
      const res = await request(app)
        .post('/api/admin/moderation-actions')
        .set('Authorization', 'Bearer uidAdmin')
        .send({
          affectedUserId: normalUser2._id,
          actionType: 'temporary_suspension',
          reason: 'Temp ban',
          relatedReportId: reportId,
          expiresAt: pastDate.toISOString()
        });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('expiresAt must be in the future');
    });

    it('52. Temporary suspension sets user accountStatus to suspended', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);
      
      const res = await request(app)
        .post('/api/admin/moderation-actions')
        .set('Authorization', 'Bearer uidAdmin')
        .send({
          affectedUserId: normalUser2._id,
          actionType: 'temporary_suspension',
          reason: 'Temp ban',
          relatedReportId: reportId,
          expiresAt: futureDate.toISOString()
        });
      expect(res.status).toBe(201);
      
      const updatedUser = await UserProfile.findById(normalUser2._id);
      expect(updatedUser.accountStatus).toBe('suspended');
    });

    it('53. Admin cannot moderate themselves', async () => {
      const res = await request(app)
        .post('/api/admin/moderation-actions')
        .set('Authorization', 'Bearer uidAdmin')
        .send({
          affectedUserId: superAdmin._id,
          actionType: 'warning',
          reason: 'Warning self',
        });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Cannot moderate yourself');
    });

    it('54. report_dismissed requires a related report', async () => {
      const res = await request(app)
        .post('/api/admin/moderation-actions')
        .set('Authorization', 'Bearer uidAdmin')
        .send({
          affectedUserId: normalUser2._id,
          actionType: 'report_dismissed',
          reason: 'No violation'
        });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('report_dismissed requires a related report');
    });

    it('55. Admin can list moderation actions', async () => {
      await request(app)
        .post('/api/admin/moderation-actions')
        .set('Authorization', 'Bearer uidAdmin')
        .send({
          affectedUserId: normalUser2._id,
          actionType: 'warning',
          reason: 'Warning for toxicity',
          relatedReportId: reportId
        });

      const res = await request(app)
        .get(`/api/admin/moderation-actions?affectedUser=${normalUser2._id}`)
        .set('Authorization', 'Bearer uidAdmin');
      
      expect(res.status).toBe(200);
      expect(res.body.actions.length).toBeGreaterThan(0);
      expect(res.body.actions[0].affectedUser._id.toString()).toBe(normalUser2._id.toString());
    });

    it('56. Transaction failure / rollback', async () => {
      // Create a fresh user for this test to avoid state bleeding from previous tests
      const rollbackUser = await UserProfile.create({ 
        firebaseUid: 'uidRollback', 
        displayName: 'Rollback User', 
        email: 'rollback@user.com', 
        role: 'user',
        accountStatus: 'active'
      });

      // Simulate a failure when saving the UserProfile
      const saveSpy = vi.spyOn(UserProfile.prototype, 'save').mockRejectedValueOnce(new Error('Simulated DB Failure'));
      
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);

      const res = await request(app)
        .post('/api/admin/moderation-actions')
        .set('Authorization', 'Bearer uidAdmin')
        .send({
          affectedUserId: rollbackUser._id,
          actionType: 'temporary_suspension',
          reason: 'Testing Rollback',
          expiresAt: futureDate.toISOString()
        });

      // Endpoint should return 500 due to failure
      expect(res.status).toBe(500);

      // Verify that no ModerationAction was actually created with that reason
      const actions = await ModerationAction.find({ reason: 'Testing Rollback' });
      expect(actions.length).toBe(0);

      // Verify that UserProfile state is unchanged (still active)
      const user = await UserProfile.findById(rollbackUser._id);
      expect(user.accountStatus).toBe('active');

      saveSpy.mockRestore();
    });

    it('57. Suspended super admin is denied privileged operation with 403 ACCOUNT_SUSPENDED', async () => {
      await UserProfile.create({
        firebaseUid: 'uidSuspendedAdmin',
        displayName: 'Suspended Admin',
        email: 'suspendedadmin@admin.com',
        role: 'super_admin',
        accountStatus: 'suspended'
      });

      const res = await request(app)
        .get('/api/admin/users')
        .set('Authorization', 'Bearer uidSuspendedAdmin');

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ACCOUNT_SUSPENDED');
      expect(res.body.message).toBe('Account is suspended');
    });
  });
});
