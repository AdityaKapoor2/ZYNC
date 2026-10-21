import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { connectTestDB, closeTestDB, clearTestDB } from './setup.js';
import UserProfile from '../src/models/UserProfile.js';

// Mock auth middleware matching test suite conventions
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
    // Token acts as the firebaseUid in tests
    req.user = { uid: token, email: `${token}@test.com` };
    next();
  }
}));

import profileRoutes from '../src/routes/profileRoutes.js';
import presenceRoutes from '../src/routes/presenceRoutes.js';

const app = express();
app.use(express.json());
app.use('/api/profiles', profileRoutes);
app.use('/api/presence', presenceRoutes);

describe('SEC-02 & SEC-03: Suspended User Restrictions on Profiles and Presence', () => {
  let activeUser, suspendedUser;

  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();

    activeUser = await UserProfile.create({
      firebaseUid: 'uidActive',
      displayName: 'Active Player',
      email: 'active@test.com',
      role: 'user',
      accountStatus: 'active',
      games: [{
        gameName: 'Valorant',
        inGameName: 'ActiveGamer#1234',
        skillLevel: 50
      }]
    });

    suspendedUser = await UserProfile.create({
      firebaseUid: 'uidSuspended',
      displayName: 'Suspended Player',
      email: 'suspended@test.com',
      role: 'user',
      accountStatus: 'suspended',
      games: [{
        gameName: 'Valorant',
        inGameName: 'SuspendedGamer#5678',
        skillLevel: 40
      }]
    });
  });

  describe('SEC-02 — Profile Routes (/api/profiles)', () => {
    it('1. Suspended user receives 403 ACCOUNT_SUSPENDED when attempting to update profile via PUT /api/profiles/me', async () => {
      const res = await request(app)
        .put('/api/profiles/me')
        .set('Authorization', 'Bearer uidSuspended')
        .send({
          displayName: 'Hacked Name',
          games: [{
            gameName: 'Valorant',
            inGameName: 'HackedName#0000'
          }]
        });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        message: 'Account is suspended',
        code: 'ACCOUNT_SUSPENDED'
      });

      // Verify profile in database remains unchanged
      const freshDoc = await UserProfile.findById(suspendedUser._id);
      expect(freshDoc.displayName).toBe('Suspended Player');
      expect(freshDoc.games[0].inGameName).toBe('SuspendedGamer#5678');
    });

    it('2. Active user can successfully update their profile via PUT /api/profiles/me', async () => {
      const res = await request(app)
        .put('/api/profiles/me')
        .set('Authorization', 'Bearer uidActive')
        .send({
          displayName: 'Updated Active Player',
          games: [{
            gameName: 'Valorant',
            inGameName: 'NewActiveIGN#9999'
          }]
        });

      expect(res.status).toBe(200);
      expect(res.body.displayName).toBe('Updated Active Player');
      expect(res.body.games[0].inGameName).toBe('NewActiveIGN#9999');

      const freshDoc = await UserProfile.findById(activeUser._id);
      expect(freshDoc.displayName).toBe('Updated Active Player');
    });

    it('3. Suspended user can still read their own profile via GET /api/profiles/me', async () => {
      const res = await request(app)
        .get('/api/profiles/me')
        .set('Authorization', 'Bearer uidSuspended');

      expect(res.status).toBe(200);
      expect(res.body.displayName).toBe('Suspended Player');
      expect(res.body.accountStatus).toBe('suspended');
    });

    it('4. Unauthenticated request to PUT /api/profiles/me is rejected with 401', async () => {
      const res = await request(app)
        .put('/api/profiles/me')
        .send({ displayName: 'Anonymous' });

      expect(res.status).toBe(401);
    });
  });

  describe('SEC-03 — Presence Routes (/api/presence)', () => {
    it('5. Suspended user receives 403 ACCOUNT_SUSPENDED when attempting POST /api/presence/online', async () => {
      const res = await request(app)
        .post('/api/presence/online')
        .set('Authorization', 'Bearer uidSuspended');

      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        message: 'Account is suspended',
        code: 'ACCOUNT_SUSPENDED'
      });

      // Verify presence in database was not mutated
      const freshDoc = await UserProfile.findById(suspendedUser._id);
      expect(freshDoc.isOnline).toBe(false);
      expect(freshDoc.onlineUntil).toBeUndefined();
    });

    it('6. Suspended user receives 403 ACCOUNT_SUSPENDED when attempting POST /api/presence/offline', async () => {
      const res = await request(app)
        .post('/api/presence/offline')
        .set('Authorization', 'Bearer uidSuspended');

      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        message: 'Account is suspended',
        code: 'ACCOUNT_SUSPENDED'
      });
    });

    it('7. Active user can successfully broadcast online and offline presence', async () => {
      // Set Online
      const onlineRes = await request(app)
        .post('/api/presence/online')
        .set('Authorization', 'Bearer uidActive');

      expect(onlineRes.status).toBe(200);
      expect(onlineRes.body.isOnline).toBe(true);
      expect(onlineRes.body.onlineUntil).toBeDefined();

      let freshDoc = await UserProfile.findById(activeUser._id);
      expect(freshDoc.isOnline).toBe(true);

      // Set Offline
      const offlineRes = await request(app)
        .post('/api/presence/offline')
        .set('Authorization', 'Bearer uidActive');

      expect(offlineRes.status).toBe(200);
      expect(offlineRes.body.isOnline).toBe(false);
      expect(offlineRes.body.onlineUntil).toBeNull();

      freshDoc = await UserProfile.findById(activeUser._id);
      expect(freshDoc.isOnline).toBe(false);
    });

    it('8. Suspended user can still read their presence status via GET /api/presence/me', async () => {
      const res = await request(app)
        .get('/api/presence/me')
        .set('Authorization', 'Bearer uidSuspended');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('isOnline');
      expect(res.body.isOnline).toBe(false);
    });

    it('9. Unauthenticated request to POST /api/presence/online is rejected with 401', async () => {
      const res = await request(app).post('/api/presence/online');
      expect(res.status).toBe(401);
    });
  });
});
