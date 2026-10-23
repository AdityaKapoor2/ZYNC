import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import crypto from 'crypto';

import UserProfile from '../src/models/UserProfile.js';
import Conversation from '../src/models/Conversation.js';
import Message from '../src/models/Message.js';
import { connectTestDB, closeTestDB, clearTestDB } from './setup.js';

// Mock auth middleware for REST requests
vi.mock('../src/middleware/authMiddleware.js', () => ({
  verifyToken: (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    req.user = { uid: token };
    next();
  }
}));

import chatRoutes from '../src/routes/chatRoutes.js';

const app = express();
app.use(express.json());
app.use('/api/chat', chatRoutes);

describe('Checkpoint 2B: Sequence-Based REST History Pagination', () => {
  let userA, userB, userC, suspendedUser, superAdmin;
  let populatedConv, emptyConv, moderationConv;

  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();

    // 1. Create profiles
    userA = await UserProfile.create({
      firebaseUid: 'user_a_uid',
      email: 'a@test.com',
      displayName: 'Alice',
      role: 'user',
      accountStatus: 'active'
    });

    userB = await UserProfile.create({
      firebaseUid: 'user_b_uid',
      email: 'b@test.com',
      displayName: 'Bob',
      role: 'user',
      accountStatus: 'active'
    });

    userC = await UserProfile.create({
      firebaseUid: 'user_c_uid',
      email: 'c@test.com',
      displayName: 'Charlie',
      role: 'user',
      accountStatus: 'active'
    });

    suspendedUser = await UserProfile.create({
      firebaseUid: 'suspended_uid',
      email: 'suspended@test.com',
      displayName: 'SuspendedSam',
      role: 'user',
      accountStatus: 'suspended'
    });

    superAdmin = await UserProfile.create({
      firebaseUid: 'admin_uid',
      email: 'admin@test.com',
      displayName: 'SuperAdmin',
      role: 'super_admin',
      accountStatus: 'active'
    });

    // 2. Create populated conversation with 60 messages (seq: 1..60)
    populatedConv = await Conversation.create({
      participants: [userA._id, userB._id],
      lastSeq: 60
    });

    const messagesToInsert = [];
    const baseTime = new Date('2026-10-01T00:00:00.000Z').getTime();
    for (let i = 1; i <= 60; i++) {
      messagesToInsert.push({
        conversationId: populatedConv._id,
        sender: (i % 2 === 1) ? userA._id : userB._id,
        text: `Message sequence ${i}`,
        seq: i,
        clientMessageId: crypto.randomUUID(),
        createdAt: new Date(baseTime + i * 1000)
      });
    }
    await Message.insertMany(messagesToInsert);

    // 3. Create empty conversation (lastSeq: 0)
    emptyConv = await Conversation.create({
      participants: [userA._id, userB._id],
      lastSeq: 0
    });

    // 4. Create moderation conversation with suspended user
    moderationConv = await Conversation.create({
      participants: [suspendedUser._id, superAdmin._id],
      isModeration: true,
      lastSeq: 2
    });

    await Message.create([
      {
        conversationId: moderationConv._id,
        sender: superAdmin._id,
        text: 'Moderation inquiry',
        seq: 1,
        clientMessageId: crypto.randomUUID(),
        senderRole: 'admin',
        senderDisplayName: 'ZYNC Super Admin'
      },
      {
        conversationId: moderationConv._id,
        sender: suspendedUser._id,
        text: 'Appeal statement',
        seq: 2,
        clientMessageId: crypto.randomUUID()
      }
    ]);
  });

  describe('1. Baseline Initial Loading (Default)', () => {
    it('returns the latest messages clamped by default limit (50) in ascending chronological seq order', async () => {
      const res = await request(app)
        .get(`/api/chat/conversations/${populatedConv._id}/messages`)
        .set('Authorization', 'Bearer user_a_uid');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('messages');
      expect(res.body).toHaveProperty('lastSeq', 60);
      expect(res.body).toHaveProperty('hasMore', true);
      expect(res.body).toHaveProperty('reset', false);

      expect(res.body.messages).toHaveLength(50);
      // Messages should be the latest 50: seq 11..60, ordered ascending
      expect(res.body.messages[0].seq).toBe(11);
      expect(res.body.messages[49].seq).toBe(60);

      // Verify strict monotonic ascending order
      for (let i = 0; i < res.body.messages.length - 1; i++) {
        expect(res.body.messages[i + 1].seq).toBeGreaterThan(res.body.messages[i].seq);
      }
    });

    it('returns hasMore: false when total messages is less than or equal to limit', async () => {
      const res = await request(app)
        .get(`/api/chat/conversations/${populatedConv._id}/messages?limit=70`)
        .set('Authorization', 'Bearer user_a_uid');

      expect(res.status).toBe(200);
      expect(res.body.messages).toHaveLength(60);
      expect(res.body.hasMore).toBe(false);
      expect(res.body.lastSeq).toBe(60);
      expect(res.body.reset).toBe(false);
      expect(res.body.messages[0].seq).toBe(1);
      expect(res.body.messages[59].seq).toBe(60);
    });
  });

  describe('2. Forward Incremental Recovery (afterSeq)', () => {
    it('returns messages with seq > afterSeq in ascending order', async () => {
      const res = await request(app)
        .get(`/api/chat/conversations/${populatedConv._id}/messages?afterSeq=10&limit=5`)
        .set('Authorization', 'Bearer user_a_uid');

      expect(res.status).toBe(200);
      expect(res.body.messages).toHaveLength(5);
      expect(res.body.hasMore).toBe(true);
      expect(res.body.lastSeq).toBe(60);
      expect(res.body.reset).toBe(false);

      expect(res.body.messages.map(m => m.seq)).toEqual([11, 12, 13, 14, 15]);
    });

    it('returns afterSeq=0 from the beginning of sequence history', async () => {
      const res = await request(app)
        .get(`/api/chat/conversations/${populatedConv._id}/messages?afterSeq=0&limit=3`)
        .set('Authorization', 'Bearer user_a_uid');

      expect(res.status).toBe(200);
      expect(res.body.messages).toHaveLength(3);
      expect(res.body.messages.map(m => m.seq)).toEqual([1, 2, 3]);
      expect(res.body.hasMore).toBe(true);
      expect(res.body.lastSeq).toBe(60);
    });

    it('returns hasMore: false when afterSeq reaches the frontier', async () => {
      const res = await request(app)
        .get(`/api/chat/conversations/${populatedConv._id}/messages?afterSeq=55&limit=10`)
        .set('Authorization', 'Bearer user_a_uid');

      expect(res.status).toBe(200);
      expect(res.body.messages).toHaveLength(5);
      expect(res.body.messages.map(m => m.seq)).toEqual([56, 57, 58, 59, 60]);
      expect(res.body.hasMore).toBe(false);
      expect(res.body.lastSeq).toBe(60);
      expect(res.body.reset).toBe(false);
    });

    it('returns empty messages and reset: false when afterSeq === lastSeq', async () => {
      const res = await request(app)
        .get(`/api/chat/conversations/${populatedConv._id}/messages?afterSeq=60`)
        .set('Authorization', 'Bearer user_a_uid');

      expect(res.status).toBe(200);
      expect(res.body.messages).toHaveLength(0);
      expect(res.body.lastSeq).toBe(60);
      expect(res.body.hasMore).toBe(false);
      expect(res.body.reset).toBe(false);
    });

    it('signals reset: true when afterSeq > lastSeq (ahead of server frontier)', async () => {
      const res = await request(app)
        .get(`/api/chat/conversations/${populatedConv._id}/messages?afterSeq=75`)
        .set('Authorization', 'Bearer user_a_uid');

      expect(res.status).toBe(200);
      expect(res.body.messages).toHaveLength(0);
      expect(res.body.lastSeq).toBe(60);
      expect(res.body.hasMore).toBe(false);
      expect(res.body.reset).toBe(true);
    });
  });

  describe('3. Backward History Pagination (beforeSeq)', () => {
    it('fetches older messages with seq < beforeSeq and returns them in ascending chronological order', async () => {
      const res = await request(app)
        .get(`/api/chat/conversations/${populatedConv._id}/messages?beforeSeq=20&limit=5`)
        .set('Authorization', 'Bearer user_a_uid');

      expect(res.status).toBe(200);
      expect(res.body.messages).toHaveLength(5);
      // Older messages immediately preceding 20 are 15, 16, 17, 18, 19
      expect(res.body.messages.map(m => m.seq)).toEqual([15, 16, 17, 18, 19]);
      expect(res.body.hasMore).toBe(true); // There are messages 1..14
      expect(res.body.lastSeq).toBe(60); // Authoritative conversation lastSeq
      expect(res.body.reset).toBe(false);
    });

    it('returns hasMore: false when beforeSeq reaches the oldest message (seq 1)', async () => {
      const res = await request(app)
        .get(`/api/chat/conversations/${populatedConv._id}/messages?beforeSeq=6&limit=10`)
        .set('Authorization', 'Bearer user_a_uid');

      expect(res.status).toBe(200);
      expect(res.body.messages).toHaveLength(5);
      expect(res.body.messages.map(m => m.seq)).toEqual([1, 2, 3, 4, 5]);
      expect(res.body.hasMore).toBe(false);
      expect(res.body.lastSeq).toBe(60);
      expect(res.body.reset).toBe(false);
    });

    it('returns empty array when beforeSeq is 1 (no messages with seq < 1)', async () => {
      const res = await request(app)
        .get(`/api/chat/conversations/${populatedConv._id}/messages?beforeSeq=1`)
        .set('Authorization', 'Bearer user_a_uid');

      expect(res.status).toBe(200);
      expect(res.body.messages).toHaveLength(0);
      expect(res.body.hasMore).toBe(false);
      expect(res.body.lastSeq).toBe(60);
      expect(res.body.reset).toBe(false);
    });
  });

  describe('4. Limit Clamping and Validation', () => {
    it('clamps limit to maximum 100 when a value > 100 is requested', async () => {
      const res = await request(app)
        .get(`/api/chat/conversations/${populatedConv._id}/messages?limit=200`)
        .set('Authorization', 'Bearer user_a_uid');

      expect(res.status).toBe(200);
      // We have 60 messages total, so limit 100 returns all 60
      expect(res.body.messages).toHaveLength(60);
      expect(res.body.hasMore).toBe(false);
    });

    it('respects small valid limit within 1-100', async () => {
      const res = await request(app)
        .get(`/api/chat/conversations/${populatedConv._id}/messages?limit=1`)
        .set('Authorization', 'Bearer user_a_uid');

      expect(res.status).toBe(200);
      expect(res.body.messages).toHaveLength(1);
      expect(res.body.messages[0].seq).toBe(60);
      expect(res.body.hasMore).toBe(true);
    });

    it('rejects limit=0 with 400', async () => {
      const res = await request(app)
        .get(`/api/chat/conversations/${populatedConv._id}/messages?limit=0`)
        .set('Authorization', 'Bearer user_a_uid');

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid "limit"');
    });

    it('rejects negative limit with 400', async () => {
      const res = await request(app)
        .get(`/api/chat/conversations/${populatedConv._id}/messages?limit=-5`)
        .set('Authorization', 'Bearer user_a_uid');

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid "limit"');
    });

    it('rejects fractional limit with 400', async () => {
      const res = await request(app)
        .get(`/api/chat/conversations/${populatedConv._id}/messages?limit=10.5`)
        .set('Authorization', 'Bearer user_a_uid');

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid "limit"');
    });

    it('rejects non-numeric limit with 400', async () => {
      const res = await request(app)
        .get(`/api/chat/conversations/${populatedConv._id}/messages?limit=ten`)
        .set('Authorization', 'Bearer user_a_uid');

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid "limit"');
    });

    it('rejects empty limit string with 400', async () => {
      const res = await request(app)
        .get(`/api/chat/conversations/${populatedConv._id}/messages?limit=`)
        .set('Authorization', 'Bearer user_a_uid');

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid "limit"');
    });
  });

  describe('5. Strict Query Parameter Validation & Mutual Exclusivity', () => {
    it('rejects request when both afterSeq and beforeSeq are provided', async () => {
      const res = await request(app)
        .get(`/api/chat/conversations/${populatedConv._id}/messages?afterSeq=10&beforeSeq=20`)
        .set('Authorization', 'Bearer user_a_uid');

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Cannot specify both "afterSeq" and "beforeSeq"');
    });

    it('rejects negative afterSeq with 400', async () => {
      const res = await request(app)
        .get(`/api/chat/conversations/${populatedConv._id}/messages?afterSeq=-1`)
        .set('Authorization', 'Bearer user_a_uid');

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid "afterSeq"');
    });

    it('rejects fractional afterSeq with 400', async () => {
      const res = await request(app)
        .get(`/api/chat/conversations/${populatedConv._id}/messages?afterSeq=1.5`)
        .set('Authorization', 'Bearer user_a_uid');

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid "afterSeq"');
    });

    it('rejects non-numeric afterSeq with 400', async () => {
      const res = await request(app)
        .get(`/api/chat/conversations/${populatedConv._id}/messages?afterSeq=abc`)
        .set('Authorization', 'Bearer user_a_uid');

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid "afterSeq"');
    });

    it('rejects alphanumeric/partially-parsed afterSeq with 400', async () => {
      const res = await request(app)
        .get(`/api/chat/conversations/${populatedConv._id}/messages?afterSeq=10px`)
        .set('Authorization', 'Bearer user_a_uid');

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid "afterSeq"');
    });

    it('rejects empty afterSeq string with 400', async () => {
      const res = await request(app)
        .get(`/api/chat/conversations/${populatedConv._id}/messages?afterSeq=`)
        .set('Authorization', 'Bearer user_a_uid');

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid "afterSeq"');
    });

    it('rejects beforeSeq=0 with 400 (beforeSeq must be a positive integer)', async () => {
      const res = await request(app)
        .get(`/api/chat/conversations/${populatedConv._id}/messages?beforeSeq=0`)
        .set('Authorization', 'Bearer user_a_uid');

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid "beforeSeq"');
    });

    it('rejects negative beforeSeq with 400', async () => {
      const res = await request(app)
        .get(`/api/chat/conversations/${populatedConv._id}/messages?beforeSeq=-10`)
        .set('Authorization', 'Bearer user_a_uid');

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid "beforeSeq"');
    });

    it('rejects fractional beforeSeq with 400', async () => {
      const res = await request(app)
        .get(`/api/chat/conversations/${populatedConv._id}/messages?beforeSeq=5.5`)
        .set('Authorization', 'Bearer user_a_uid');

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid "beforeSeq"');
    });

    it('rejects non-numeric beforeSeq with 400', async () => {
      const res = await request(app)
        .get(`/api/chat/conversations/${populatedConv._id}/messages?beforeSeq=xyz`)
        .set('Authorization', 'Bearer user_a_uid');

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid "beforeSeq"');
    });

    it('rejects empty beforeSeq string with 400', async () => {
      const res = await request(app)
        .get(`/api/chat/conversations/${populatedConv._id}/messages?beforeSeq=`)
        .set('Authorization', 'Bearer user_a_uid');

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid "beforeSeq"');
    });
  });

  describe('6. Empty Conversations and Frontier Invariants', () => {
    it('returns empty envelope with lastSeq: 0 and reset: false for empty conversation baseline', async () => {
      const res = await request(app)
        .get(`/api/chat/conversations/${emptyConv._id}/messages`)
        .set('Authorization', 'Bearer user_a_uid');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        messages: [],
        lastSeq: 0,
        hasMore: false,
        reset: false
      });
    });

    it('returns reset: false for afterSeq=0 on empty conversation', async () => {
      const res = await request(app)
        .get(`/api/chat/conversations/${emptyConv._id}/messages?afterSeq=0`)
        .set('Authorization', 'Bearer user_a_uid');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        messages: [],
        lastSeq: 0,
        hasMore: false,
        reset: false
      });
    });

    it('returns reset: true for afterSeq > 0 on empty conversation (ahead of server frontier)', async () => {
      const res = await request(app)
        .get(`/api/chat/conversations/${emptyConv._id}/messages?afterSeq=1`)
        .set('Authorization', 'Bearer user_a_uid');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        messages: [],
        lastSeq: 0,
        hasMore: false,
        reset: true
      });
    });

    it('authoritative lastSeq comes from conversation state, not the returned page boundary', async () => {
      // Querying an older page with beforeSeq=10 returns messages 5..9
      const res = await request(app)
        .get(`/api/chat/conversations/${populatedConv._id}/messages?beforeSeq=10&limit=5`)
        .set('Authorization', 'Bearer user_a_uid');

      expect(res.status).toBe(200);
      expect(res.body.messages).toHaveLength(5);
      const maxPageSeq = Math.max(...res.body.messages.map(m => m.seq));
      expect(maxPageSeq).toBe(9);
      // The envelope lastSeq must NOT be 9; it must be the conversation's authoritative lastSeq (60)
      expect(res.body.lastSeq).toBe(60);
    });
  });

  describe('7. Authorization, Moderation, and Access Control', () => {
    it('returns 400 for malformed conversationId', async () => {
      const res = await request(app)
        .get('/api/chat/conversations/not-an-objectid/messages')
        .set('Authorization', 'Bearer user_a_uid');

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Invalid conversation ID format');
    });

    it('returns 404 for valid non-existent conversationId', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .get(`/api/chat/conversations/${fakeId}/messages`)
        .set('Authorization', 'Bearer user_a_uid');

      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Conversation not found');
    });

    it('returns 404 if caller profile does not exist', async () => {
      const res = await request(app)
        .get(`/api/chat/conversations/${populatedConv._id}/messages`)
        .set('Authorization', 'Bearer non_existent_uid');

      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Profile not found');
    });

    it('returns 403 when user is not a participant in the conversation', async () => {
      const res = await request(app)
        .get(`/api/chat/conversations/${populatedConv._id}/messages`)
        .set('Authorization', 'Bearer user_c_uid');

      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Not authorized to view this conversation');
    });

    it('returns 403 when user is suspended and conversation is non-moderation', async () => {
      // Add suspended user to a regular conversation
      const regularConv = await Conversation.create({
        participants: [suspendedUser._id, userA._id],
        isModeration: false,
        lastSeq: 0
      });

      const res = await request(app)
        .get(`/api/chat/conversations/${regularConv._id}/messages`)
        .set('Authorization', 'Bearer suspended_uid');

      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Account is suspended');
      expect(res.body.code).toBe('ACCOUNT_SUSPENDED');
    });

    it('returns 200 when suspended user accesses an authorized moderation conversation', async () => {
      const res = await request(app)
        .get(`/api/chat/conversations/${moderationConv._id}/messages`)
        .set('Authorization', 'Bearer suspended_uid');

      expect(res.status).toBe(200);
      expect(res.body.messages).toHaveLength(2);
      expect(res.body.messages[0].text).toBe('Moderation inquiry');
      expect(res.body.messages[1].text).toBe('Appeal statement');
      expect(res.body.lastSeq).toBe(2);
    });

    it('allows super_admin to access conversation even if role check applies', async () => {
      const res = await request(app)
        .get(`/api/chat/conversations/${moderationConv._id}/messages`)
        .set('Authorization', 'Bearer admin_uid');

      expect(res.status).toBe(200);
      expect(res.body.messages).toHaveLength(2);
      expect(res.body.lastSeq).toBe(2);
    });
  });
});
