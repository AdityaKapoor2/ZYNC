import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import express from 'express';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

import { vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mockUserId: null,
  mockUserRole: 'user'
}));

vi.mock('../src/middleware/authMiddleware.js', () => ({
  verifyToken: (req, res, next) => {
    if (!mocks.mockUserId) return res.status(401).json({ message: 'Unauthorized' });
    req.user = { _id: mocks.mockUserId, role: mocks.mockUserRole, accountStatus: 'active' };
    next();
  }
}));

vi.mock('../src/middleware/adminMiddleware.js', () => ({
  verifySuperAdmin: (req, res, next) => {
    if (mocks.mockUserRole !== 'super_admin') return res.status(403).json({ message: 'Forbidden' });
    next();
  }
}));

import UserProfile from '../src/models/UserProfile.js';
import Notification from '../src/models/Notification.js';
import BroadcastNotification from '../src/models/BroadcastNotification.js';

import adminRoutes from '../src/routes/adminRoutes.js';
import notificationRoutes from '../src/routes/notificationRoutes.js';

const app = express();
app.use(express.json());

app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);

let replSet;
let user1Id, user2Id, adminId;

describe('Notification Routes', () => {
  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    await UserProfile.deleteMany({});
    await Notification.deleteMany({});
    await BroadcastNotification.deleteMany({});

    // Create Admin
    const admin = await UserProfile.create({
      firebaseUid: 'adminUid',
      email: 'admin@example.com',
      displayName: 'Admin User',
      role: 'super_admin',
      games: []
    });
    adminId = admin._id;

    // Create User 1 (Valorant)
    const u1 = await UserProfile.create({
      firebaseUid: 'user1Uid',
      email: 'user1@example.com',
      displayName: 'User One',
      role: 'user',
      games: [{
        gameName: 'Valorant',
        inGameName: 'U1_Val',
        skillLevel: 50,
        roles: ['Duelist'],
        availability: ['Weekends']
      }]
    });
    user1Id = u1._id;

    // Create User 2 (Brawl Stars)
    const u2 = await UserProfile.create({
      firebaseUid: 'user2Uid',
      email: 'user2@example.com',
      displayName: 'User Two',
      role: 'user',
      games: [{
        gameName: 'Brawl Stars',
        inGameName: 'U2_Brawl',
        skillLevel: 30,
        roles: ['Healer'],
        availability: ['Weekdays']
      }]
    });
    user2Id = u2._id;

    mocks.mockUserId = adminId;
    mocks.mockUserRole = 'super_admin';
  });

  describe('Admin Authorization', () => {
    it('1. unauthenticated admin notification request -> 401', async () => {
      mocks.mockUserId = null;
      const res = await request(app).post('/api/admin/notifications').send({});
      expect(res.status).toBe(401);
    });

    it('2. normal user attempting to send -> 403', async () => {
      mocks.mockUserId = user1Id;
      mocks.mockUserRole = 'user';
      const res = await request(app).post('/api/admin/notifications').send({
        audienceType: 'all',
        title: 'test',
        message: 'test'
      });
      expect(res.status).toBe(403);
    });

    it('3. normal user cannot view admin notification history -> 403', async () => {
      mocks.mockUserId = user1Id;
      mocks.mockUserRole = 'user';
      const res = await request(app).get('/api/admin/notifications');
      expect(res.status).toBe(403);
    });
  });

  describe('Audience Targeting', () => {
    it('4. all users targets the correct users', async () => {
      mocks.mockUserId = adminId;
      mocks.mockUserRole = 'super_admin';

      const res = await request(app).post('/api/admin/notifications').send({
        audienceType: 'all',
        title: 'All Update',
        message: 'Hello'
      });
      expect(res.status).toBe(201);
      expect(res.body.recipientCount).toBe(3); // admin + 2 users
      
      const notifs = await Notification.find();
      expect(notifs.length).toBe(3);
    });

    it('5. game audience targets only users who have that game', async () => {
      const res = await request(app).post('/api/admin/notifications').send({
        audienceType: 'game',
        targetGame: 'Valorant',
        title: 'Valorant Update',
        message: 'Hello'
      });
      expect(res.status).toBe(201);
      expect(res.body.recipientCount).toBe(1);
      
      const notif = await Notification.findOne();
      expect(notif.recipient.toString()).toBe(user1Id.toString());
    });

    it('6. individual audience targets exactly one user', async () => {
      const res = await request(app).post('/api/admin/notifications').send({
        audienceType: 'individual',
        recipientId: user2Id,
        title: 'Individual Update',
        message: 'Hello'
      });
      expect(res.status).toBe(201);
      expect(res.body.recipientCount).toBe(1);
      
      const notif = await Notification.findOne();
      expect(notif.recipient.toString()).toBe(user2Id.toString());
    });

    it('7. invalid audience rejected', async () => {
      const res = await request(app).post('/api/admin/notifications').send({
        audienceType: 'invalid',
        title: 'Update',
        message: 'Hello'
      });
      expect(res.status).toBe(400);
    });

    it('8. missing targetGame rejected for game audience', async () => {
      const res = await request(app).post('/api/admin/notifications').send({
        audienceType: 'game',
        title: 'Update',
        message: 'Hello'
      });
      expect(res.status).toBe(400);
    });

    it('9. missing recipientId rejected for individual audience', async () => {
      const res = await request(app).post('/api/admin/notifications').send({
        audienceType: 'individual',
        title: 'Update',
        message: 'Hello'
      });
      expect(res.status).toBe(400);
    });

    it('10. nonexistent recipient rejected', async () => {
      const res = await request(app).post('/api/admin/notifications').send({
        audienceType: 'individual',
        recipientId: new mongoose.Types.ObjectId(),
        title: 'Update',
        message: 'Hello'
      });
      expect(res.status).toBe(404);
    });
  });

  describe('User Security', () => {
    let n1, n2;

    beforeEach(async () => {
      n1 = await Notification.create({ recipient: user1Id, title: 'T1', message: 'M1' });
      n2 = await Notification.create({ recipient: user2Id, title: 'T2', message: 'M2' });
    });

    it('11. user sees only their own notifications', async () => {
      mocks.mockUserId = user1Id;
      mocks.mockUserRole = 'user';

      const res = await request(app).get('/api/notifications');
      expect(res.status).toBe(200);
      expect(res.body.notifications.length).toBe(1);
      expect(res.body.notifications[0].title).toBe('T1');
    });

    it('12. user cannot read another user\'s notification', async () => {
      mocks.mockUserId = user1Id;
      mocks.mockUserRole = 'user';
      const res = await request(app).patch(`/api/notifications/${n2._id}/read`);
      expect(res.status).toBe(404);
    });

    it('13. user cannot mark another user\'s notification as read', async () => {
      mocks.mockUserId = user1Id;
      mocks.mockUserRole = 'user';
      await request(app).patch(`/api/notifications/${n2._id}/read`);
      
      const checkN2 = await Notification.findById(n2._id);
      expect(checkN2.read).toBe(false);
    });

    it('14. unread count is correct', async () => {
      mocks.mockUserId = user1Id;
      mocks.mockUserRole = 'user';

      await Notification.create({ recipient: user1Id, title: 'T1_2', message: 'M1_2', read: true });
      
      const res = await request(app).get('/api/notifications/unread-count');
      expect(res.body.count).toBe(1);
    });

    it('15. mark read works', async () => {
      mocks.mockUserId = user1Id;
      mocks.mockUserRole = 'user';

      const res = await request(app).patch(`/api/notifications/${n1._id}/read`);
      expect(res.status).toBe(200);
      expect(res.body.read).toBe(true);

      const checkN1 = await Notification.findById(n1._id);
      expect(checkN1.read).toBe(true);
    });

    it('15b. marking an already read notification remains read without error or altering state', async () => {
      mocks.mockUserId = user1Id;
      mocks.mockUserRole = 'user';

      // First mark
      await request(app).patch(`/api/notifications/${n1._id}/read`);
      // Second mark
      const res2 = await request(app).patch(`/api/notifications/${n1._id}/read`);
      expect(res2.status).toBe(200);
      expect(res2.body.read).toBe(true);

      const countRes = await request(app).get('/api/notifications/unread-count');
      expect(countRes.body.count).toBe(0);
    });

    it('16. mark all read only affects current user', async () => {
      mocks.mockUserId = user1Id;
      mocks.mockUserRole = 'user';

      const res = await request(app).patch('/api/notifications/read-all');
      expect(res.status).toBe(200);

      const checkN1 = await Notification.findById(n1._id);
      expect(checkN1.read).toBe(true);

      const checkN2 = await Notification.findById(n2._id);
      expect(checkN2.read).toBe(false);
    });
  });

  describe('Validation & Pagination', () => {
    it('17. missing title rejected', async () => {
      const res = await request(app).post('/api/admin/notifications').send({
        audienceType: 'all',
        message: 'Hello'
      });
      expect(res.status).toBe(400);
    });

    it('18. missing message rejected', async () => {
      const res = await request(app).post('/api/admin/notifications').send({
        audienceType: 'all',
        title: 'Title'
      });
      expect(res.status).toBe(400);
    });

    it('19. excessive length rejected', async () => {
      const longTitle = 'a'.repeat(101);
      const res = await request(app).post('/api/admin/notifications').send({
        audienceType: 'all',
        title: longTitle,
        message: 'Hello'
      });
      expect(res.status).toBe(400);
    });

    it('20. notification list pagination works', async () => {
      mocks.mockUserId = user1Id;
      mocks.mockUserRole = 'user';

      await Notification.insertMany(
        Array(25).fill(null).map((_, i) => ({
          recipient: user1Id,
          title: `T${i}`,
          message: 'M'
        }))
      );

      const res1 = await request(app).get('/api/notifications?page=1&limit=10');
      expect(res1.body.notifications.length).toBe(10);
      expect(res1.body.totalPages).toBe(3);

      const res3 = await request(app).get('/api/notifications?page=3&limit=10');
      expect(res3.body.notifications.length).toBe(5);
    });

    it('21. admin history pagination works', async () => {
      mocks.mockUserId = adminId;
      mocks.mockUserRole = 'super_admin';

      await BroadcastNotification.insertMany(
        Array(25).fill(null).map((_, i) => ({
          sender: adminId,
          audienceType: 'all',
          title: `T${i}`,
          message: 'M',
          recipientCount: 0
        }))
      );

      const res1 = await request(app).get('/api/admin/notifications?page=1&limit=10');
      expect(res1.body.broadcasts.length).toBe(10);
      expect(res1.body.totalPages).toBe(3);

      const res3 = await request(app).get('/api/admin/notifications?page=3&limit=10');
      expect(res3.body.broadcasts.length).toBe(5);
    });
  });
});
