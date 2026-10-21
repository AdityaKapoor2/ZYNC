import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { connectTestDB, closeTestDB, clearTestDB } from './setup.js';

import UserProfile from '../src/models/UserProfile.js';
import Conversation from '../src/models/Conversation.js';
import Message from '../src/models/Message.js';
import Connection from '../src/models/Connection.js';
import Report from '../src/models/Report.js';

import {
  createRateLimiter,
  authRateLimiter,
  authIpRateLimiter,
  matchDiscoveryRateLimiter,
  matchExplanationRateLimiter,
  messageSendRateLimiter,
  connectionRequestRateLimiter,
  reportCreationRateLimiter,
  supportCreationRateLimiter
} from '../src/middleware/rateLimitMiddleware.js';

// Mock auth middleware to populate req.user from Bearer token
vi.mock('../src/middleware/authMiddleware.js', () => ({
  verifyToken: (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Unauthorized: No token provided' });
    }
    const token = authHeader.split(' ')[1];
    req.user = {
      uid: token,
      email: `${token}@test.com`,
      name: `User ${token}`
    };
    next();
  }
}));

// Mock enforceActiveUser to allow active test profiles through
vi.mock('../src/middleware/activeMiddleware.js', () => ({
  enforceActiveUser: (req, res, next) => next()
}));

// Mock geminiService
vi.mock('../src/services/geminiService.js', () => ({
  explainMatch: vi.fn().mockResolvedValue('Great chemistry and complement in playstyles.')
}));

// Mock matchingService
vi.mock('../src/services/matchingService.js', () => ({
  findMatches: vi.fn().mockImplementation((current, targets) => {
    if (!targets || targets.length === 0) return [];
    return [{ game: 'Valorant', score: 85, user: targets[0] }];
  })
}));

import { createApp } from '../src/app.js';

describe('SEC-06: API Rate Limiting Audit & Implementation', () => {
  let app;
  let userA, userB, userC;

  beforeAll(async () => {
    await connectTestDB();
    app = createApp();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    // Reset all rate limiter in-memory stores before each test
    authIpRateLimiter.reset();
    authRateLimiter.reset();
    matchDiscoveryRateLimiter.reset();
    matchExplanationRateLimiter.reset();
    messageSendRateLimiter.reset();
    connectionRequestRateLimiter.reset();
    reportCreationRateLimiter.reset();
    supportCreationRateLimiter.reset();

    await clearTestDB();

    userA = await UserProfile.create({
      firebaseUid: 'user_a',
      email: 'user_a@test.com',
      displayName: 'User A',
      accountStatus: 'active',
      games: [{
        gameName: 'Valorant',
        inGameName: 'UserA#1234',
        skillLevel: 60,
        roles: ['Duelist'],
        availability: ['Weekday Evenings']
      }]
    });

    userB = await UserProfile.create({
      firebaseUid: 'user_b',
      email: 'user_b@test.com',
      displayName: 'User B',
      accountStatus: 'active',
      games: [{
        gameName: 'Valorant',
        inGameName: 'UserB#1234',
        skillLevel: 65,
        roles: ['Initiator'],
        availability: ['Weekday Evenings']
      }]
    });

    userC = await UserProfile.create({
      firebaseUid: 'user_c',
      email: 'user_c@test.com',
      displayName: 'User C',
      accountStatus: 'active',
      games: [{
        gameName: 'Valorant',
        inGameName: 'UserC#1234',
        skillLevel: 50,
        roles: ['Controller'],
        availability: ['Weekends']
      }]
    });
  });

  describe('1. In-Memory Rate Limiter Core Mechanics', () => {
    it('allows requests within max and sets standard rate limit headers', async () => {
      const testLimiter = createRateLimiter({ windowMs: 60000, max: 3 });
      const testApp = express();
      testApp.get('/test', testLimiter, (req, res) => res.json({ ok: true }));

      const res1 = await request(testApp).get('/test');
      expect(res1.status).toBe(200);
      expect(res1.headers['x-ratelimit-limit']).toBe('3');
      expect(res1.headers['x-ratelimit-remaining']).toBe('2');
      expect(res1.headers['x-ratelimit-reset']).toBeDefined();

      const res2 = await request(testApp).get('/test');
      expect(res2.status).toBe(200);
      expect(res2.headers['x-ratelimit-remaining']).toBe('1');

      const res3 = await request(testApp).get('/test');
      expect(res3.status).toBe(200);
      expect(res3.headers['x-ratelimit-remaining']).toBe('0');
    });

    it('returns 429 with Retry-After when quota is exceeded', async () => {
      const testLimiter = createRateLimiter({ windowMs: 30000, max: 2, message: 'Custom rate limit exceeded' });
      const testApp = express();
      testApp.get('/test', testLimiter, (req, res) => res.json({ ok: true }));

      await request(testApp).get('/test');
      await request(testApp).get('/test');

      const blockedRes = await request(testApp).get('/test');
      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body.message).toBe('Custom rate limit exceeded');
      expect(blockedRes.body.retryAfter).toBeGreaterThan(0);
      expect(blockedRes.headers['retry-after']).toBeDefined();
    });

    it('tracks independent users separately without shared depletion', async () => {
      const testLimiter = createRateLimiter({ windowMs: 60000, max: 2 });
      const testApp = express();
      testApp.get('/test', (req, res, next) => {
        req.user = { uid: req.headers['x-test-user'] };
        next();
      }, testLimiter, (req, res) => res.json({ ok: true }));

      // Exhaust User 1
      await request(testApp).get('/test').set('x-test-user', 'user1');
      await request(testApp).get('/test').set('x-test-user', 'user1');
      const user1Blocked = await request(testApp).get('/test').set('x-test-user', 'user1');
      expect(user1Blocked.status).toBe(429);

      // User 2 should still have full quota
      const user2Allowed = await request(testApp).get('/test').set('x-test-user', 'user2');
      expect(user2Allowed.status).toBe(200);
      expect(user2Allowed.headers['x-ratelimit-remaining']).toBe('1');
    });

    it('resets counters after the windowMs elapses without real waiting', () => {
      const fakeNow = 1000000;
      vi.useFakeTimers();
      vi.setSystemTime(fakeNow);

      try {
        const testLimiter = createRateLimiter({ windowMs: 60000, max: 1 });
        const mockReq = { user: { uid: 'timer_user' } };
        const mockRes = {
          status: vi.fn().mockReturnThis(),
          json: vi.fn(),
          set: vi.fn()
        };
        const mockNext = vi.fn();

        // 1st request -> allowed
        testLimiter(mockReq, mockRes, mockNext);
        expect(mockNext).toHaveBeenCalledTimes(1);

        // 2nd request -> blocked (429)
        testLimiter(mockReq, mockRes, mockNext);
        expect(mockRes.status).toHaveBeenCalledWith(429);

        // Advance system time past 60s window
        vi.setSystemTime(fakeNow + 61000);

        // 3rd request -> window has rolled, allowed again
        const nextAfterReset = vi.fn();
        testLimiter(mockReq, mockRes, nextAfterReset);
        expect(nextAfterReset).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('cleans up stale entries when cache exceeds 500 entries', () => {
      const testLimiter = createRateLimiter({ windowMs: 1000, max: 10 });
      const now = Date.now();
      vi.useFakeTimers();
      vi.setSystemTime(now);

      try {
        const mockRes = { status: vi.fn().mockReturnThis(), json: vi.fn(), set: vi.fn() };
        const mockNext = vi.fn();

        // Populate 501 expired entries
        for (let i = 0; i < 501; i++) {
          testLimiter({ user: { uid: `old_user_${i}` } }, mockRes, mockNext);
        }

        // Advance time so all earlier entries become stale
        vi.setSystemTime(now + 2000);

        // Trigger one more request to invoke cleanup
        testLimiter({ user: { uid: 'new_active_user' } }, mockRes, mockNext);
        expect(mockNext).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not silently skip rate limiting when keyGenerator returns null or empty; fails safely to server identity', async () => {
      const brokenLimiter = createRateLimiter({
        windowMs: 60000,
        max: 2,
        keyGenerator: () => null // Simulates missing identity key
      });
      const testApp = express();
      testApp.get('/broken-key', brokenLimiter, (req, res) => res.json({ ok: true }));

      // Requests 1 & 2 succeed under the fallback identity bucket
      const res1 = await request(testApp).get('/broken-key');
      expect(res1.status).toBe(200);

      const res2 = await request(testApp).get('/broken-key');
      expect(res2.status).toBe(200);

      // Request 3 is blocked (429) rather than bypassing rate limiting via next()
      const res3 = await request(testApp).get('/broken-key');
      expect(res3.status).toBe(429);
      expect(res3.body.message).toBe('Too many requests, please try again later.');
    });
  });

  describe('2. Endpoint-Specific Rate Limit Enforcement', () => {
    it('authRateLimiter: enforces 30 req/min on POST /api/auth/verify', async () => {
      // 30 allowed requests
      for (let i = 0; i < 30; i++) {
        const res = await request(app)
          .post('/api/auth/verify')
          .set('Authorization', 'Bearer user_a');
        expect(res.status).toBe(200);
      }

      // 31st request is blocked
      const blockedRes = await request(app)
        .post('/api/auth/verify')
        .set('Authorization', 'Bearer user_a');
      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body.message).toContain('Too many authentication attempts');

      // Different user is not blocked
      const otherUserRes = await request(app)
        .post('/api/auth/verify')
        .set('Authorization', 'Bearer user_b');
      expect(otherUserRes.status).toBe(200);
    });

    it('authIpRateLimiter: limits unauthenticated abuse on POST /api/auth/verify before token verification', async () => {
      const attackerIp = '198.51.100.99';

      // 60 requests without token are rejected with 401 Unauthorized
      for (let i = 0; i < 60; i++) {
        const res = await request(app)
          .post('/api/auth/verify')
          .set('X-Forwarded-For', attackerIp);
        expect(res.status).toBe(401);
      }

      // 61st request from the same IP is blocked at the IP layer with 429 BEFORE token verification
      const blockedRes = await request(app)
        .post('/api/auth/verify')
        .set('X-Forwarded-For', attackerIp);
      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body.message).toContain('Too many authentication attempts from this IP address');

      // A different legitimate IP can still authenticate successfully with a valid token
      const legitRes = await request(app)
        .post('/api/auth/verify')
        .set('X-Forwarded-For', '203.0.113.88')
        .set('Authorization', 'Bearer user_a');
      expect(legitRes.status).toBe(200);
    });

    it('authIpRateLimiter: enforces limit when req.ip is completely unavailable, preserving legitimate IPs', async () => {
      authIpRateLimiter.reset();

      // Create an app where req.ip and remoteAddress are intentionally undefined
      const noIpApp = express();
      noIpApp.use(express.json());
      noIpApp.post('/api/auth/verify', (req, res, next) => {
        Object.defineProperty(req, 'ip', { value: undefined, configurable: true });
        if (req.socket) {
          Object.defineProperty(req.socket, 'remoteAddress', { value: undefined, configurable: true });
        }
        next();
      }, authIpRateLimiter, (req, res) => res.status(401).json({ message: 'Unauthorized: No token provided' }));

      // 60 requests with missing IP succeed under fallback identity
      for (let i = 0; i < 60; i++) {
        const res = await request(noIpApp).post('/api/auth/verify');
        expect(res.status).toBe(401);
      }

      // 61st request with missing IP is throttled (429) rather than skipping rate limiting
      const blockedRes = await request(noIpApp).post('/api/auth/verify');
      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body.message).toContain('Too many authentication attempts');
    });

    it('matchDiscoveryRateLimiter: enforces 30 req/min on GET /api/matches', async () => {
      for (let i = 0; i < 30; i++) {
        const res = await request(app)
          .get('/api/matches')
          .set('Authorization', 'Bearer user_a');
        expect(res.status).toBe(200);
      }

      const blockedRes = await request(app)
        .get('/api/matches')
        .set('Authorization', 'Bearer user_a');
      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body.message).toContain('Too many match discovery requests');

      // User B is unaffected
      const userBRes = await request(app)
        .get('/api/matches')
        .set('Authorization', 'Bearer user_b');
      expect(userBRes.status).toBe(200);
    });

    it('matchExplanationRateLimiter: enforces 10 req/min on GET /api/matches/:targetUserId/explanation', async () => {
      for (let i = 0; i < 10; i++) {
        const res = await request(app)
          .get(`/api/matches/${userB._id}/explanation`)
          .set('Authorization', 'Bearer user_a');
        expect(res.status).toBe(200);
      }

      const blockedRes = await request(app)
        .get(`/api/matches/${userB._id}/explanation`)
        .set('Authorization', 'Bearer user_a');
      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body.message).toContain('Too many match explanation requests');
    });

    it('messageSendRateLimiter: enforces 60 msgs/min on POST /api/chat/conversations/:id/messages', async () => {
      await Connection.create({
        requester: userA._id,
        recipient: userB._id,
        status: 'accepted'
      });

      const conv = await Conversation.create({
        participants: [userA._id, userB._id]
      });

      for (let i = 0; i < 60; i++) {
        const res = await request(app)
          .post(`/api/chat/conversations/${conv._id}/messages`)
          .set('Authorization', 'Bearer user_a')
          .send({ text: `Message ${i}` });
        expect(res.status).toBe(201);
      }

      const blockedRes = await request(app)
        .post(`/api/chat/conversations/${conv._id}/messages`)
        .set('Authorization', 'Bearer user_a')
        .send({ text: 'Spam message' });
      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body.message).toContain('You are sending messages too quickly');

      // User B in the same conversation can still send a message
      const userBRes = await request(app)
        .post(`/api/chat/conversations/${conv._id}/messages`)
        .set('Authorization', 'Bearer user_b')
        .send({ text: 'Reply from User B' });
      expect(userBRes.status).toBe(201);
    });

    it('connectionRequestRateLimiter: enforces 15 req/15min on POST /api/connections/request/:userId', async () => {
      // Create 16 dummy target user profiles
      const targetProfiles = [];
      for (let i = 0; i < 16; i++) {
        const p = await UserProfile.create({
          firebaseUid: `target_${i}`,
          email: `target_${i}@test.com`,
          displayName: `Target ${i}`,
          accountStatus: 'active'
        });
        targetProfiles.push(p);
      }

      for (let i = 0; i < 15; i++) {
        const res = await request(app)
          .post(`/api/connections/request/${targetProfiles[i]._id}`)
          .set('Authorization', 'Bearer user_a');
        expect(res.status).toBe(201);
      }

      const blockedRes = await request(app)
        .post(`/api/connections/request/${targetProfiles[15]._id}`)
        .set('Authorization', 'Bearer user_a');
      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body.message).toContain('Too many connection requests sent');
    });

    it('reportCreationRateLimiter: enforces 10 req/hour on POST /api/reports', async () => {
      // Create 11 distinct target users to avoid in-controller duplicate 24h report check
      const targetUsers = [];
      for (let i = 0; i < 11; i++) {
        const u = await UserProfile.create({
          firebaseUid: `reported_target_${i}`,
          email: `reported_${i}@test.com`,
          displayName: `Reported User ${i}`,
          accountStatus: 'active'
        });
        targetUsers.push(u);
      }

      for (let i = 0; i < 10; i++) {
        const res = await request(app)
          .post('/api/reports')
          .set('Authorization', 'Bearer user_a')
          .send({
            reportedUserId: targetUsers[i]._id.toString(),
            reason: 'Spam',
            description: `Report reason ${i}`
          });
        expect(res.status).toBe(201);
      }

      const blockedRes = await request(app)
        .post('/api/reports')
        .set('Authorization', 'Bearer user_a')
        .send({
          reportedUserId: targetUsers[10]._id.toString(),
          reason: 'Harassment',
          description: 'Excessive report'
        });
      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body.message).toContain('Too many reports submitted');
    });
  });

  describe('3. Security & Anti-Bypass Validation', () => {
    it('keyed by verified server identity: tampering with payload body does not bypass rate limit', async () => {
      await Connection.create({
        requester: userA._id,
        recipient: userB._id,
        status: 'accepted'
      });

      const conv = await Conversation.create({
        participants: [userA._id, userB._id]
      });

      for (let i = 0; i < 60; i++) {
        await request(app)
          .post(`/api/chat/conversations/${conv._id}/messages`)
          .set('Authorization', 'Bearer user_a')
          .send({ text: `Message ${i}`, senderId: 'fake_attacker_id' });
      }

      // Attacker attempts to change body senderId / userId
      const bypassAttempt = await request(app)
        .post(`/api/chat/conversations/${conv._id}/messages`)
        .set('Authorization', 'Bearer user_a')
        .send({ text: 'Bypass message', senderId: 'user_b' });

      expect(bypassAttempt.status).toBe(429);
    });

    it('trust proxy is configured and parses X-Forwarded-For client IP correctly', async () => {
      // In Express with trust proxy = 1, req.ip resolves the client IP from the upstream proxy hop
      const testLimiter = createRateLimiter({
        windowMs: 60000,
        max: 2,
        keyGenerator: (req) => req.ip
      });

      const proxyApp = createApp();
      proxyApp.get('/api/test-ip-limit', testLimiter, (req, res) => {
        res.json({ clientIp: req.ip });
      });

      // Request from Client 203.0.113.195 via proxy
      const res1 = await request(proxyApp)
        .get('/api/test-ip-limit')
        .set('X-Forwarded-For', '203.0.113.195');
      expect(res1.status).toBe(200);
      expect(res1.body.clientIp).toBe('203.0.113.195');

      await request(proxyApp)
        .get('/api/test-ip-limit')
        .set('X-Forwarded-For', '203.0.113.195');

      // 3rd request from 203.0.113.195 is blocked
      const blockedRes = await request(proxyApp)
        .get('/api/test-ip-limit')
        .set('X-Forwarded-For', '203.0.113.195');
      expect(blockedRes.status).toBe(429);

      // Different client 198.51.100.42 still has available quota
      const otherIpRes = await request(proxyApp)
        .get('/api/test-ip-limit')
        .set('X-Forwarded-For', '198.51.100.42');
      expect(otherIpRes.status).toBe(200);
      expect(otherIpRes.body.clientIp).toBe('198.51.100.42');
    });

    it('trust proxy = 1 prevents evasion: client-forged X-Forwarded-For prefixes are stripped and ignored', async () => {
      // Proves that when a reverse proxy appends the client IP (203.0.113.195),
      // prepended attacker values (e.g. 1.1.1.1, 2.2.2.2) cannot evade the rate limit
      const testLimiter = createRateLimiter({
        windowMs: 60000,
        max: 2,
        keyGenerator: (req) => req.ip
      });

      const proxyApp = createApp();
      proxyApp.get('/api/test-evasion', testLimiter, (req, res) => {
        res.json({ clientIp: req.ip });
      });

      // Request 1: attacker sends forged 1.1.1.1; proxy appends real client IP 203.0.113.195
      const res1 = await request(proxyApp)
        .get('/api/test-evasion')
        .set('X-Forwarded-For', '1.1.1.1, 203.0.113.195');
      expect(res1.status).toBe(200);
      expect(res1.body.clientIp).toBe('203.0.113.195');

      // Request 2: attacker sends forged 2.2.2.2; proxy appends real client IP 203.0.113.195
      const res2 = await request(proxyApp)
        .get('/api/test-evasion')
        .set('X-Forwarded-For', '2.2.2.2, 203.0.113.195');
      expect(res2.status).toBe(200);
      expect(res2.body.clientIp).toBe('203.0.113.195');

      // Request 3: attacker sends multi-hop forged header; proxy appends 203.0.113.195
      // Because trust proxy is 1, Express ignores all forged prefixes and identifies 203.0.113.195
      const res3 = await request(proxyApp)
        .get('/api/test-evasion')
        .set('X-Forwarded-For', '3.3.3.3, 4.4.4.4, 203.0.113.195');
      expect(res3.status).toBe(429);
    });

    it('supports custom TRUST_PROXY configuration (e.g. false to ignore X-Forwarded-For on bare servers)', async () => {
      const untrustedApp = createApp(null, false);
      untrustedApp.get('/api/test-proxy-disabled', (req, res) => {
        res.json({ clientIp: req.ip });
      });

      const res = await request(untrustedApp)
        .get('/api/test-proxy-disabled')
        .set('X-Forwarded-For', '203.0.113.195');

      expect(res.status).toBe(200);
      // With trust proxy: false, Express ignores X-Forwarded-For header completely
      expect(res.body.clientIp).not.toBe('203.0.113.195');
    });
  });
});
