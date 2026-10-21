import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

import UserProfile from '../src/models/UserProfile.js';
import SupportTicket from '../src/models/SupportTicket.js';
import ModerationAction from '../src/models/ModerationAction.js';
import Conversation from '../src/models/Conversation.js';
import Message from '../src/models/Message.js';
import Notification from '../src/models/Notification.js';

// Mock auth middleware matching test suite conventions
vi.mock('../src/middleware/authMiddleware.js', () => ({
  verifyToken: (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    req.user = { uid: token, email: `${token}@test.com` };
    next();
  }
}));

import supportRoutes from '../src/routes/supportRoutes.js';
import { supportCreationRateLimiter } from '../src/middleware/rateLimitMiddleware.js';

const app = express();
app.use(express.json());
app.use('/api/support', supportRoutes);

describe('SEC-05: Rate Limiting for Support Ticket and Appeal Creation', () => {
  let replSet;
  let activeUserA, activeUserB, suspendedUser, superAdmin;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    supportCreationRateLimiter.reset();
    await UserProfile.deleteMany({});
    await SupportTicket.deleteMany({});
    await ModerationAction.deleteMany({});
    await Conversation.deleteMany({});
    await Message.deleteMany({});
    await Notification.deleteMany({});

    superAdmin = await UserProfile.create({
      firebaseUid: 'admin_uid',
      email: 'admin@zync.gg',
      displayName: 'Super Admin',
      role: 'super_admin',
      accountStatus: 'active'
    });

    activeUserA = await UserProfile.create({
      firebaseUid: 'user_a_uid',
      email: 'usera@zync.gg',
      displayName: 'User Alpha',
      role: 'user',
      accountStatus: 'active'
    });

    activeUserB = await UserProfile.create({
      firebaseUid: 'user_b_uid',
      email: 'userb@zync.gg',
      displayName: 'User Beta',
      role: 'user',
      accountStatus: 'active'
    });

    suspendedUser = await UserProfile.create({
      firebaseUid: 'suspended_uid',
      email: 'suspended@zync.gg',
      displayName: 'Suspended Player',
      role: 'user',
      accountStatus: 'suspended'
    });
  });

  it('1. Enforces limit of 5 ticket creations per 15 minutes, returning 429 and Retry-After on 6th request', async () => {
    // First 5 requests succeed
    for (let i = 1; i <= 5; i++) {
      const res = await request(app)
        .post('/api/support/tickets')
        .set('Authorization', 'Bearer user_a_uid')
        .send({
          category: 'general',
          subject: `Ticket #${i}`,
          message: `Inquiry message ${i}`
        });

      expect(res.status).toBe(201);
      expect(res.body.subject).toBe(`Ticket #${i}`);
      expect(res.headers['x-ratelimit-remaining']).toBe(String(5 - i));
    }

    // 6th request must be rejected with 429 Too Many Requests
    const blockedRes = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', 'Bearer user_a_uid')
      .send({
        category: 'general',
        subject: 'Ticket #6 (Blocked)',
        message: 'This should be rate limited'
      });

    expect(blockedRes.status).toBe(429);
    expect(blockedRes.body).toHaveProperty('message');
    expect(blockedRes.body.message).toContain('Too many support requests created');
    expect(blockedRes.body).toHaveProperty('retryAfter');
    expect(typeof blockedRes.body.retryAfter).toBe('number');
    expect(blockedRes.body.retryAfter).toBeGreaterThan(0);
    expect(blockedRes.headers['retry-after']).toBe(String(blockedRes.body.retryAfter));
  });

  it('2. Independent user quotas: rate limiting one user does not affect another user', async () => {
    // User A consumes all 5 quota slots
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/support/tickets')
        .set('Authorization', 'Bearer user_a_uid')
        .send({ category: 'billing', subject: `Bill ${i}`, message: 'Billing inquiry' });
    }

    // User A is blocked
    const userABlocked = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', 'Bearer user_a_uid')
      .send({ category: 'billing', subject: 'Bill 6', message: 'More billing' });
    expect(userABlocked.status).toBe(429);

    // User B should still be able to create tickets without interference
    const userBRes = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', 'Bearer user_b_uid')
      .send({ category: 'bug_report', subject: 'Bug report', message: 'Found a bug' });

    expect(userBRes.status).toBe(201);
    expect(userBRes.body.subject).toBe('Bug report');
  });

  it('3. Suspended user is rate-limited on support tickets and appeals', async () => {
    // Suspended user submits 5 appeals/account-access tickets
    for (let i = 1; i <= 5; i++) {
      const res = await request(app)
        .post('/api/support/tickets')
        .set('Authorization', 'Bearer suspended_uid')
        .send({
          category: 'suspension_appeal',
          subject: `Appeal Attempt ${i}`,
          message: 'Please review my suspension'
        });
      expect(res.status).toBe(201);
    }

    // 6th attempt is rate-limited
    const blockedAppeal = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', 'Bearer suspended_uid')
      .send({
        category: 'suspension_appeal',
        subject: 'Appeal Attempt 6',
        message: 'Excessive appeal attempt'
      });
    expect(blockedAppeal.status).toBe(429);
    expect(blockedAppeal.body.message).toContain('Too many support requests created');
  });

  it('4. Shared limiter: POST /tickets and POST /appeal share the same creation pool', async () => {
    // Suspended user submits 3 tickets via /api/support/tickets
    for (let i = 1; i <= 3; i++) {
      const res = await request(app)
        .post('/api/support/tickets')
        .set('Authorization', 'Bearer suspended_uid')
        .send({
          category: 'account_access',
          subject: `Access request ${i}`,
          message: 'Need account access help'
        });
      expect(res.status).toBe(201);
    }

    // Same suspended user submits 2 appeals via legacy /api/support/appeal
    for (let i = 1; i <= 2; i++) {
      const res = await request(app)
        .post('/api/support/appeal')
        .set('Authorization', 'Bearer suspended_uid')
        .send({ message: `Appeal message ${i}` });
      expect(res.status).toBe(201);
    }

    // Total of 5 creation requests used across both endpoints.
    // 6th attempt to /tickets must be blocked with 429
    const ticketAttempt6 = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', 'Bearer suspended_uid')
      .send({
        category: 'suspension_appeal',
        subject: 'Blocked Ticket',
        message: 'Should be 429'
      });
    expect(ticketAttempt6.status).toBe(429);

    // 6th attempt to /appeal must also be blocked with 429
    const appealAttempt6 = await request(app)
      .post('/api/support/appeal')
      .set('Authorization', 'Bearer suspended_uid')
      .send({ message: 'Should also be 429' });
    expect(appealAttempt6.status).toBe(429);
  });

  it('5. Rate limiting on creation does NOT block reading tickets or replying to existing tickets', async () => {
    // Create an initial ticket first
    const initialTicketRes = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', 'Bearer user_a_uid')
      .send({ category: 'general', subject: 'Initial inquiry', message: 'Hello support' });
    expect(initialTicketRes.status).toBe(201);
    const ticketId = initialTicketRes.body._id;

    // Now exhaust remaining 4 creation slots + 1 more to trigger 429
    for (let i = 0; i < 4; i++) {
      await request(app)
        .post('/api/support/tickets')
        .set('Authorization', 'Bearer user_a_uid')
        .send({ category: 'general', subject: `Extra ${i}`, message: 'Extra' });
    }

    const blockedRes = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', 'Bearer user_a_uid')
      .send({ category: 'general', subject: 'Blocked', message: 'Blocked' });
    expect(blockedRes.status).toBe(429);

    // User A can still list their own tickets
    const listRes = await request(app)
      .get('/api/support/tickets')
      .set('Authorization', 'Bearer user_a_uid');
    expect(listRes.status).toBe(200);
    expect(listRes.body.length).toBe(5);

    // User A can still view specific ticket details
    const detailRes = await request(app)
      .get(`/api/support/tickets/${ticketId}`)
      .set('Authorization', 'Bearer user_a_uid');
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.subject).toBe('Initial inquiry');

    // User A can still post a reply to an existing open ticket
    const replyRes = await request(app)
      .post(`/api/support/tickets/${ticketId}/reply`)
      .set('Authorization', 'Bearer user_a_uid')
      .send({ text: 'Following up on this ticket.' });
    expect(replyRes.status).toBe(201);
    expect(replyRes.body.messages).toHaveLength(2);
  });
});
