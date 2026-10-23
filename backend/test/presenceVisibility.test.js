import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';

import UserProfile from '../src/models/UserProfile.js';
import Conversation from '../src/models/Conversation.js';
import Connection from '../src/models/Connection.js';
import Message from '../src/models/Message.js';
import { connectTestDB, closeTestDB, clearTestDB } from './setup.js';

// Mock auth middleware to translate Bearer token to req.user.uid
vi.mock('../src/middleware/authMiddleware.js', () => ({
  verifyToken: (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: 'Unauthorized' });
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    const token = parts[1];
    if (token === 'invalid') {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    req.user = { uid: token, email: `${token}@zync.test` };
    next();
  }
}));

// Mock rate limiters so they don't block tests
vi.mock('../src/middleware/rateLimitMiddleware.js', () => ({
  matchDiscoveryRateLimiter: (req, res, next) => next(),
  matchExplanationRateLimiter: (req, res, next) => next(),
  messageSendRateLimiter: (req, res, next) => next(),
  connectionRequestRateLimiter: (req, res, next) => next()
}));

// Mock socketService
vi.mock('../src/services/socketService.js', () => ({
  emitToUser: vi.fn(),
  emitToOfficialConversation: vi.fn()
}));

import presenceRoutes from '../src/routes/presenceRoutes.js';
import connectionRoutes from '../src/routes/connectionRoutes.js';
import chatRoutes from '../src/routes/chatRoutes.js';
import matchRoutes from '../src/routes/matchRoutes.js';
import profileRoutes from '../src/routes/profileRoutes.js';

const app = express();
app.use(express.json());
app.use('/api/presence', presenceRoutes);
app.use('/api/connections', connectionRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/profiles', profileRoutes);

describe('Checkpoint P2: Visibility Preference and Presence API', () => {
  let userA, userB, suspendedUser;

  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();

    userA = await UserProfile.create({
      firebaseUid: 'uidA',
      displayName: 'Alice',
      email: 'alice@zync.test',
      role: 'user',
      accountStatus: 'active',
      games: [{
        gameName: 'Valorant',
        inGameName: 'Alice#1234',
        skillLevel: 50,
        availability: ['evening'],
        roles: ['duelist'],
        playstyle: 'Aggressive',
        communication: 'Voice',
        competitiveGoals: 'Ranked'
      }]
    });

    userB = await UserProfile.create({
      firebaseUid: 'uidB',
      displayName: 'Bob',
      email: 'bob@zync.test',
      role: 'user',
      accountStatus: 'active',
      games: [{
        gameName: 'Valorant',
        inGameName: 'Bob#5678',
        skillLevel: 50,
        availability: ['evening'],
        roles: ['initiator'],
        playstyle: 'Tactical',
        communication: 'Voice',
        competitiveGoals: 'Ranked'
      }]
    });

    suspendedUser = await UserProfile.create({
      firebaseUid: 'uidSuspended',
      displayName: 'Suspended Sam',
      email: 'sam@zync.test',
      role: 'user',
      accountStatus: 'suspended'
    });
  });

  describe('1. Model Defaults & Legacy Document Compatibility', () => {
    it('sets visibilityPreference to "online" by default for newly created profiles', async () => {
      const freshDoc = await UserProfile.findById(userA._id);
      expect(freshDoc.visibilityPreference).toBe('online');
      expect(freshDoc.isOnline).toBe(false);
    });

    it('treats legacy profiles without visibilityPreference as "online"', async () => {
      // Simulate a legacy BSON document missing the visibilityPreference key
      await UserProfile.collection.updateOne(
        { _id: userB._id },
        { $unset: { visibilityPreference: "" } }
      );

      const res = await request(app)
        .get('/api/presence/me')
        .set('Authorization', 'Bearer uidB');

      expect(res.status).toBe(200);
      expect(res.body.visibilityPreference).toBe('online');
    });
  });

  describe('2. Authenticated Visibility Preference Changes', () => {
    it('updates visibility preference to "invisible" via POST /api/presence/visibility', async () => {
      // First make user online
      await request(app)
        .post('/api/presence/online')
        .set('Authorization', 'Bearer uidA');

      const res = await request(app)
        .post('/api/presence/visibility')
        .set('Authorization', 'Bearer uidA')
        .send({ visibilityPreference: 'invisible' });

      expect(res.status).toBe(200);
      expect(res.body.visibilityPreference).toBe('invisible');
      expect(res.body.isOnline).toBe(false);
      expect(res.body.onlineUntil).toBeNull();

      const freshDoc = await UserProfile.findById(userA._id);
      expect(freshDoc.visibilityPreference).toBe('invisible');
      expect(freshDoc.isOnline).toBe(false);
      expect(freshDoc.onlineUntil).toBeNull();
    });

    it('updates visibility preference via PUT /api/presence/visibility', async () => {
      const res = await request(app)
        .put('/api/presence/visibility')
        .set('Authorization', 'Bearer uidA')
        .send({ visibilityPreference: 'invisible' });

      expect(res.status).toBe(200);
      expect(res.body.visibilityPreference).toBe('invisible');
    });

    it('setting preference to "online" does NOT automatically promote offline user to online (Requirement 7)', async () => {
      // User is currently offline
      const res = await request(app)
        .post('/api/presence/visibility')
        .set('Authorization', 'Bearer uidA')
        .send({ visibilityPreference: 'online' });

      expect(res.status).toBe(200);
      expect(res.body.visibilityPreference).toBe('online');
      expect(res.body.isOnline).toBe(false);

      const freshDoc = await UserProfile.findById(userA._id);
      expect(freshDoc.isOnline).toBe(false);
    });
  });

  describe('3. Validation & Authorization Restrictions', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await request(app)
        .post('/api/presence/visibility')
        .send({ visibilityPreference: 'invisible' });
      expect(res.status).toBe(401);
    });

    it('rejects invalid visibility preference values with 400', async () => {
      const res = await request(app)
        .post('/api/presence/visibility')
        .set('Authorization', 'Bearer uidA')
        .send({ visibilityPreference: 'away' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Invalid visibility preference/i);
    });

    it('rejects missing visibility preference payload with 400', async () => {
      const res = await request(app)
        .post('/api/presence/visibility')
        .set('Authorization', 'Bearer uidA')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/visibilityPreference is required/i);
    });

    it('rejects non-string values with 400', async () => {
      const res = await request(app)
        .post('/api/presence/visibility')
        .set('Authorization', 'Bearer uidA')
        .send({ visibilityPreference: 12345 });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/visibilityPreference must be a string/i);
    });

    it('rejects attempts to change another user\'s preference with 403', async () => {
      const res = await request(app)
        .post('/api/presence/visibility')
        .set('Authorization', 'Bearer uidA')
        .send({
          visibilityPreference: 'invisible',
          userId: userB._id.toString()
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Cannot modify visibility preference of another user/i);

      // Verify userB was not modified
      const freshUserB = await UserProfile.findById(userB._id);
      expect(freshUserB.visibilityPreference).toBe('online');
    });

    it('rejects suspended users with 403 ACCOUNT_SUSPENDED', async () => {
      const res = await request(app)
        .post('/api/presence/visibility')
        .set('Authorization', 'Bearer uidSuspended')
        .send({ visibilityPreference: 'invisible' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ACCOUNT_SUSPENDED');
    });
  });

  describe('4. Manual Online Toggle Behavior vs Invisible Preference (Requirement 5 & 8)', () => {
    it('prevents POST /api/presence/online from overriding Invisible preference', async () => {
      // Set to invisible
      await request(app)
        .post('/api/presence/visibility')
        .set('Authorization', 'Bearer uidA')
        .send({ visibilityPreference: 'invisible' });

      // Attempt to go online
      const onlineRes = await request(app)
        .post('/api/presence/online')
        .set('Authorization', 'Bearer uidA');

      expect(onlineRes.status).toBe(200);
      expect(onlineRes.body.isOnline).toBe(false);
      expect(onlineRes.body.onlineUntil).toBeNull();
      expect(onlineRes.body.visibilityPreference).toBe('invisible');

      // Verify database was NOT changed to isOnline: true
      const freshDoc = await UserProfile.findById(userA._id);
      expect(freshDoc.isOnline).toBe(false);
      expect(freshDoc.onlineUntil).toBeNull();
    });

    it('preserves existing 30-minute onlineUntil contract for "online" users (Requirement 8)', async () => {
      const beforeTime = Date.now();
      const onlineRes = await request(app)
        .post('/api/presence/online')
        .set('Authorization', 'Bearer uidA');

      expect(onlineRes.status).toBe(200);
      expect(onlineRes.body.isOnline).toBe(true);
      expect(onlineRes.body.onlineUntil).toBeDefined();

      const expires = new Date(onlineRes.body.onlineUntil).getTime();
      const thirtyMinutesMs = 30 * 60 * 1000;
      expect(expires).toBeGreaterThanOrEqual(beforeTime + thirtyMinutesMs - 2000);
      expect(expires).toBeLessThanOrEqual(beforeTime + thirtyMinutesMs + 5000);
    });
  });

  describe('5. Invisible Users Reported Offline Across All Presence Surfaces', () => {
    beforeEach(async () => {
      // Set UserB to invisible
      await request(app)
        .post('/api/presence/visibility')
        .set('Authorization', 'Bearer uidB')
        .send({ visibilityPreference: 'invisible' });

      // Create accepted connection between UserA and UserB
      await Connection.create({
        requester: userA._id,
        recipient: userB._id,
        status: 'accepted'
      });
      await UserProfile.findByIdAndUpdate(userA._id, { $addToSet: { connections: userB._id } });
      await UserProfile.findByIdAndUpdate(userB._id, { $addToSet: { connections: userA._id } });

      // Create conversation between UserA and UserB
      await Conversation.create({
        participants: [userA._id, userB._id],
        isModeration: false
      });
    });

    it('Surface 1: GET /api/presence/me returns offline for invisible user', async () => {
      const res = await request(app)
        .get('/api/presence/me')
        .set('Authorization', 'Bearer uidB');

      expect(res.status).toBe(200);
      expect(res.body.isOnline).toBe(false);
      expect(res.body.onlineUntil).toBeNull();
      expect(res.body.visibilityPreference).toBe('invisible');
    });

    it('Surface 2: GET /api/connections masks invisible friend presence and deletes visibilityPreference', async () => {
      const res = await request(app)
        .get('/api/connections')
        .set('Authorization', 'Bearer uidA');

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
      const friend = res.body[0].user;
      expect(friend._id.toString()).toBe(userB._id.toString());
      expect(friend.isOnline).toBe(false);
      expect(friend.onlineUntil).toBeNull();
      expect(friend.visibilityPreference).toBeUndefined(); // Private setting must not leak
    });

    it('Surface 3: GET /api/chat/conversations masks invisible participant presence', async () => {
      const res = await request(app)
        .get('/api/chat/conversations')
        .set('Authorization', 'Bearer uidA');

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
      const otherParticipant = res.body[0].participants.find(p => p._id.toString() === userB._id.toString());
      expect(otherParticipant).toBeDefined();
      expect(otherParticipant.isOnline).toBe(false);
      expect(otherParticipant.onlineUntil).toBeNull();
      expect(otherParticipant.visibilityPreference).toBeUndefined();
    });

    it('Surface 4: POST /api/chat/conversations/:targetUserId masks invisible participant presence', async () => {
      const res = await request(app)
        .post(`/api/chat/conversations/${userB._id}`)
        .set('Authorization', 'Bearer uidA');

      expect(res.status).toBe(200);
      const otherParticipant = res.body.participants.find(p => p._id.toString() === userB._id.toString());
      expect(otherParticipant).toBeDefined();
      expect(otherParticipant.isOnline).toBe(false);
      expect(otherParticipant.onlineUntil).toBeNull();
      expect(otherParticipant.visibilityPreference).toBeUndefined();
    });

    it('Surface 5: GET /api/profiles/user/:id (public profile) masks invisible presence and strips preference', async () => {
      const res = await request(app)
        .get(`/api/profiles/user/${userB._id}`)
        .set('Authorization', 'Bearer uidA');

      expect(res.status).toBe(200);
      expect(res.body.isOnline).toBe(false);
      expect(res.body.onlineUntil).toBeNull();
      expect(res.body.visibilityPreference).toBeUndefined();
    });

    it('Surface 6: GET /api/matches reports invisible candidate as offline and gives no "Online Now" bonus', async () => {
      // Disconnect userA and userB so they appear in teammate discovery
      await Connection.deleteMany({});
      await UserProfile.findByIdAndUpdate(userA._id, { $set: { connections: [] } });
      await UserProfile.findByIdAndUpdate(userB._id, { $set: { connections: [] } });

      const res = await request(app)
        .get('/api/matches')
        .set('Authorization', 'Bearer uidA');

      expect(res.status).toBe(200);
      expect(res.body.matches).toBeDefined();
      const candidateB = res.body.matches.find(m => m.userId === userB._id.toString());
      expect(candidateB).toBeDefined();
      expect(candidateB.isOnline).toBe(false);
      expect(candidateB.matchReasons).not.toContain('Online Now');
    });
  });
});
