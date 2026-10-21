import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import { connectTestDB, closeTestDB, clearTestDB } from './setup.js';

// Mock auth middleware matching project test conventions
vi.mock('../src/middleware/authMiddleware.js', () => ({
  verifyToken: (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    req.user = { uid: token, email: `${token}@example.com` };
    next();
  }
}));

import UserProfile from '../src/models/UserProfile.js';
import SupportTicket from '../src/models/SupportTicket.js';

import profileRoutes from '../src/routes/profileRoutes.js';
import connectionRoutes from '../src/routes/connectionRoutes.js';
import chatRoutes from '../src/routes/chatRoutes.js';
import ratingRoutes from '../src/routes/ratingRoutes.js';
import supportRoutes from '../src/routes/supportRoutes.js';

const app = express();
app.use(express.json());
app.use('/api/profiles', profileRoutes);
app.use('/api/connections', connectionRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/ratings', ratingRoutes);
app.use('/api/support', supportRoutes);

describe('SEC-04: MongoDB ObjectId Validation', () => {
  let activeUser, targetUser, adminUser;

  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();

    activeUser = await UserProfile.create({
      firebaseUid: 'active_uid',
      displayName: 'Active Gamer',
      email: 'active@example.com',
      role: 'user',
      accountStatus: 'active',
      games: [{ gameName: 'Valorant', inGameName: 'Active#123' }]
    });

    targetUser = await UserProfile.create({
      firebaseUid: 'target_uid',
      displayName: 'Target Gamer',
      email: 'target@example.com',
      role: 'user',
      accountStatus: 'active',
      games: [{ gameName: 'Valorant', inGameName: 'Target#123' }]
    });

    adminUser = await UserProfile.create({
      firebaseUid: 'admin_uid',
      displayName: 'Admin User',
      email: 'admin@example.com',
      role: 'super_admin',
      accountStatus: 'active'
    });
  });

  describe('1. Profile Controller (profileController.js)', () => {
    it('GET /api/profiles/user/:id returns 400 for malformed ObjectId', async () => {
      const res = await request(app)
        .get('/api/profiles/user/not-a-valid-objectid')
        .set('Authorization', 'Bearer active_uid');

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Invalid user ID format');
    });

    it('GET /api/profiles/user/:id returns 404 for valid-format non-existent ObjectId', async () => {
      const nonExistentId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .get(`/api/profiles/user/${nonExistentId}`)
        .set('Authorization', 'Bearer active_uid');

      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Profile not found');
    });

    it('GET /api/profiles/user/:id returns 200 for valid existing ObjectId', async () => {
      const res = await request(app)
        .get(`/api/profiles/user/${targetUser._id}`)
        .set('Authorization', 'Bearer active_uid');

      expect(res.status).toBe(200);
      expect(res.body._id).toBe(targetUser._id.toString());
      expect(res.body.displayName).toBe('Target Gamer');
    });
  });

  describe('2. Connection Controller (connectionController.js)', () => {
    it('POST /api/connections/request/:userId returns 400 for malformed userId', async () => {
      const res = await request(app)
        .post('/api/connections/request/malformed-user-id')
        .set('Authorization', 'Bearer active_uid');

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Invalid user ID format');
    });

    it('POST /api/connections/request/:userId returns 404 for valid non-existent userId', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .post(`/api/connections/request/${fakeId}`)
        .set('Authorization', 'Bearer active_uid');

      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Target user not found');
    });

    it('PUT /api/connections/:connectionId/accept returns 400 for malformed connectionId', async () => {
      const res = await request(app)
        .put('/api/connections/invalid-connection-id/accept')
        .set('Authorization', 'Bearer active_uid');

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Invalid connection ID format');
    });

    it('PUT /api/connections/:connectionId/accept returns 404 for valid non-existent connectionId', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .put(`/api/connections/${fakeId}/accept`)
        .set('Authorization', 'Bearer active_uid');

      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Connection request not found');
    });

    it('PUT /api/connections/:connectionId/reject returns 400 for malformed connectionId', async () => {
      const res = await request(app)
        .put('/api/connections/123-malformed/reject')
        .set('Authorization', 'Bearer active_uid');

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Invalid connection ID format');
    });

    it('DELETE /api/connections/:connectionId returns 400 for malformed connectionId', async () => {
      const res = await request(app)
        .delete('/api/connections/bad-conn-id')
        .set('Authorization', 'Bearer active_uid');

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Invalid connection ID format');
    });
  });

  describe('3. Chat Controller (chatController.js)', () => {
    it('POST /api/chat/conversations/:targetUserId returns 400 for malformed targetUserId', async () => {
      const res = await request(app)
        .post('/api/chat/conversations/not-an-id')
        .set('Authorization', 'Bearer active_uid');

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Invalid user ID format');
    });

    it('POST /api/chat/conversations/:targetUserId returns 404 for valid non-existent targetUserId', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .post(`/api/chat/conversations/${fakeId}`)
        .set('Authorization', 'Bearer active_uid');

      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Target profile not found');
    });

    it('GET /api/chat/conversations/:conversationId/messages returns 400 for malformed conversationId', async () => {
      const res = await request(app)
        .get('/api/chat/conversations/invalid-conv-id/messages')
        .set('Authorization', 'Bearer active_uid');

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Invalid conversation ID format');
    });

    it('GET /api/chat/conversations/:conversationId/messages returns 404 for valid non-existent conversationId', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .get(`/api/chat/conversations/${fakeId}/messages`)
        .set('Authorization', 'Bearer active_uid');

      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Conversation not found');
    });

    it('POST /api/chat/conversations/:conversationId/messages returns 400 for malformed conversationId', async () => {
      const res = await request(app)
        .post('/api/chat/conversations/malformed-conv-id/messages')
        .set('Authorization', 'Bearer active_uid')
        .send({ text: 'Hello!' });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Invalid conversation ID format');
    });
  });

  describe('4. Rating Controller (ratingController.js)', () => {
    it('POST /api/ratings returns 400 for malformed ratedUserId', async () => {
      const res = await request(app)
        .post('/api/ratings')
        .set('Authorization', 'Bearer active_uid')
        .send({
          ratedUserId: 'invalid-user-id',
          overall: 5
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Invalid rated user ID format');
    });

    it('POST /api/ratings returns 400 for missing ratedUserId', async () => {
      const res = await request(app)
        .post('/api/ratings')
        .set('Authorization', 'Bearer active_uid')
        .send({
          overall: 5
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Invalid rated user ID format');
    });

    it('POST /api/ratings returns 404 for valid non-existent ratedUserId', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .post('/api/ratings')
        .set('Authorization', 'Bearer active_uid')
        .send({
          ratedUserId: fakeId.toString(),
          overall: 5
        });

      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Rated user profile not found.');
    });
  });

  describe('5. Support Controller (supportController.js)', () => {
    let testTicket;

    beforeEach(async () => {
      testTicket = await SupportTicket.create({
        ticketNumber: 'TCK-TEST-001',
        creator: activeUser._id,
        creatorEmail: activeUser.email,
        accountStatusAtCreation: 'active',
        category: 'bug_report',
        subject: 'Test Bug',
        status: 'open',
        priority: 'normal',
        messages: [{
          sender: activeUser._id,
          senderRole: 'user',
          senderDisplayName: 'Active Gamer',
          text: 'Initial bug report',
          createdAt: new Date()
        }]
      });
    });

    it('GET /api/support/tickets/:id returns 400 for malformed ticket ID', async () => {
      const res = await request(app)
        .get('/api/support/tickets/not-an-id')
        .set('Authorization', 'Bearer active_uid');

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Invalid ticket ID format');
    });

    it('GET /api/support/tickets/:id returns 404 for valid non-existent ticket ID', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .get(`/api/support/tickets/${fakeId}`)
        .set('Authorization', 'Bearer active_uid');

      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Support ticket not found');
    });

    it('POST /api/support/tickets/:id/reply returns 400 for malformed ticket ID', async () => {
      const res = await request(app)
        .post('/api/support/tickets/bad-ticket-id/reply')
        .set('Authorization', 'Bearer active_uid')
        .send({ text: 'Here is a reply' });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Invalid ticket ID format');
    });

    it('GET /api/support/admin/tickets with malformed assignedStaff returns 400', async () => {
      const res = await request(app)
        .get('/api/support/admin/tickets?assignedStaff=invalid-staff-id')
        .set('Authorization', 'Bearer admin_uid');

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Invalid assigned staff ID format');
    });

    it('GET /api/support/admin/tickets with valid assignedStaff or unassigned returns 200', async () => {
      const resUnassigned = await request(app)
        .get('/api/support/admin/tickets?assignedStaff=unassigned')
        .set('Authorization', 'Bearer admin_uid');

      expect(resUnassigned.status).toBe(200);

      const resStaff = await request(app)
        .get(`/api/support/admin/tickets?assignedStaff=${adminUser._id}`)
        .set('Authorization', 'Bearer admin_uid');

      expect(resStaff.status).toBe(200);
    });

    it('PATCH /api/support/admin/tickets/:id returns 400 for malformed ticket ID', async () => {
      const res = await request(app)
        .patch('/api/support/admin/tickets/bad-id')
        .set('Authorization', 'Bearer admin_uid')
        .send({ status: 'in_progress' });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Invalid ticket ID format');
    });

    it('PATCH /api/support/admin/tickets/:id returns 400 for valid ticket ID but malformed assignedStaff', async () => {
      const res = await request(app)
        .patch(`/api/support/admin/tickets/${testTicket._id}`)
        .set('Authorization', 'Bearer admin_uid')
        .send({ assignedStaff: 'not-a-valid-objectid' });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Invalid assigned staff ID format');
    });

    it('POST /api/support/admin/tickets/:id/notes returns 400 for malformed ticket ID', async () => {
      const res = await request(app)
        .post('/api/support/admin/tickets/bad-ticket-id/notes')
        .set('Authorization', 'Bearer admin_uid')
        .send({ note: 'Staff internal note' });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Invalid ticket ID format');
    });
  });

  describe('6. Distinction: Firebase UIDs and Ticket Numbers', () => {
    it('Firebase UIDs with arbitrary string formats are not rejected as invalid ObjectIds', async () => {
      // Firebase UIDs are often arbitrary strings (e.g. 'user-alphanumeric-123')
      const res = await request(app)
        .get('/api/profiles/me')
        .set('Authorization', 'Bearer active_uid');

      expect(res.status).toBe(200);
      expect(res.body.firebaseUid).toBe('active_uid');
    });

    it('Ticket creation correctly produces string ticket numbers (e.g. TCK-...)', async () => {
      const res = await request(app)
        .post('/api/support/tickets')
        .set('Authorization', 'Bearer active_uid')
        .send({
          category: 'general',
          subject: 'General inquiry',
          message: 'Can I change my region?'
        });

      expect(res.status).toBe(201);
      expect(res.body.ticketNumber).toMatch(/^TCK-\d{8}-\d{4}$/);
      expect(mongoose.Types.ObjectId.isValid(res.body._id)).toBe(true);
    });
  });
});
