import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import crypto from 'crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

import UserProfile from '../src/models/UserProfile.js';
import Conversation from '../src/models/Conversation.js';
import Message from '../src/models/Message.js';

vi.mock('../src/middleware/authMiddleware.js', () => ({
  verifyToken: (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    req.user = { uid: token };
    next();
  }
}));

import supportRoutes from '../src/routes/supportRoutes.js';
import chatRoutes from '../src/routes/chatRoutes.js';
import { supportCreationRateLimiter } from '../src/middleware/rateLimitMiddleware.js';

const app = express();
app.use(express.json());
app.use('/api/support', supportRoutes);
app.use('/api/chat', chatRoutes);

let replSet;
let adminProfile, suspendedUser, activeUser;

describe('Support / Appeal Routes', () => {
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
    await Conversation.deleteMany({});
    await Message.deleteMany({});

    adminProfile = await UserProfile.create({
      firebaseUid: 'admin_uid',
      email: 'admin@example.com',
      displayName: 'Super Admin',
      role: 'super_admin',
      accountStatus: 'active',
      games: []
    });

    suspendedUser = await UserProfile.create({
      firebaseUid: 'suspended_uid',
      email: 'suspended@example.com',
      displayName: 'Suspended User',
      role: 'user',
      accountStatus: 'suspended',
      games: []
    });

    activeUser = await UserProfile.create({
      firebaseUid: 'active_uid',
      email: 'active@example.com',
      displayName: 'Active User',
      role: 'user',
      accountStatus: 'active',
      games: []
    });
  });

  it('1. Suspended user can submit an appeal', async () => {
    const res = await request(app)
      .post('/api/support/appeal')
      .set('Authorization', 'Bearer suspended_uid')
      .send({ message: 'Please unban me' });

    expect(res.status).toBe(201);
    expect(res.body.conversationId).toBeDefined();

    const conversation = await Conversation.findById(res.body.conversationId);
    expect(conversation.isModeration).toBe(true);
    expect(conversation.participants.length).toBe(2);
    expect(conversation.participants).toContainEqual(suspendedUser._id);
    expect(conversation.participants).toContainEqual(adminProfile._id);

    const message = await Message.findOne({ conversationId: conversation._id });
    expect(message.text).toBe('Please unban me');
    expect(message.sender.toString()).toBe(suspendedUser._id.toString());
  });

  it('2. Active user cannot use the suspended-user appeal endpoint', async () => {
    const res = await request(app)
      .post('/api/support/appeal')
      .set('Authorization', 'Bearer active_uid')
      .send({ message: 'I am active' });

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Only suspended users can submit appeals');
  });

  it('3 & 4. Suspended user cannot bypass normal chat restrictions', async () => {
    const conv = await Conversation.create({
      participants: [suspendedUser._id, activeUser._id],
      isModeration: false
    });

    const res = await request(app)
      .post(`/api/chat/conversations/${conv._id}/messages`)
      .set('Authorization', 'Bearer suspended_uid')
      .send({ text: 'Hello' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('5 & 7. Suspended user can access ONLY their moderation conversation and send follow-ups', async () => {
    const adminRes = await request(app)
      .post('/api/support/appeal')
      .set('Authorization', 'Bearer suspended_uid')
      .send({ message: 'First message' });

    const convId = adminRes.body.conversationId;

    const getRes = await request(app)
      .get(`/api/chat/conversations/${convId}/messages`)
      .set('Authorization', 'Bearer suspended_uid');

    expect(getRes.status).toBe(200);
    expect((getRes.body.messages || getRes.body).length).toBe(1);

    const replyRes = await request(app)
      .post(`/api/chat/conversations/${convId}/messages`)
      .set('Authorization', 'Bearer suspended_uid')
      .send({ text: 'Second message', clientMessageId: crypto.randomUUID() });

    expect(replyRes.status).toBe(201);
    expect(replyRes.body.text).toBe('Second message');
  });

  it('6. Suspended user cannot access another suspended users moderation conversation', async () => {
    const otherSuspended = await UserProfile.create({
      firebaseUid: 'other_susp_uid',
      email: 'other@example.com',
      displayName: 'Other',
      role: 'user',
      accountStatus: 'suspended'
    });

    const adminRes = await request(app)
      .post('/api/support/appeal')
      .set('Authorization', 'Bearer other_susp_uid')
      .send({ message: 'First message' });

    const convId = adminRes.body.conversationId;

    const getRes = await request(app)
      .get(`/api/chat/conversations/${convId}/messages`)
      .set('Authorization', 'Bearer suspended_uid');

    expect(getRes.status).toBe(403);
    expect(getRes.body.message).toBe('Not authorized to view this conversation');
  });

  it('8 & 9. Super Admin can read the moderation conversation and reply', async () => {
    const userRes = await request(app)
      .post('/api/support/appeal')
      .set('Authorization', 'Bearer suspended_uid')
      .send({ message: 'Hello' });

    const convId = userRes.body.conversationId;

    const getRes = await request(app)
      .get(`/api/chat/conversations/${convId}/messages`)
      .set('Authorization', 'Bearer admin_uid');

    expect(getRes.status).toBe(200);

    const replyRes = await request(app)
      .post(`/api/chat/conversations/${convId}/messages`)
      .set('Authorization', 'Bearer admin_uid')
      .send({ text: 'Admin reply', clientMessageId: crypto.randomUUID() });

    expect(replyRes.status).toBe(201);
  });

  it('11. Duplicate moderation conversations are not created', async () => {
    const res1 = await request(app)
      .post('/api/support/appeal')
      .set('Authorization', 'Bearer suspended_uid')
      .send({ message: 'First' });

    const res2 = await request(app)
      .post('/api/support/appeal')
      .set('Authorization', 'Bearer suspended_uid')
      .send({ message: 'Second' });

    expect(res1.body.conversationId).toBe(res2.body.conversationId);
    
    const count = await Conversation.countDocuments({ isModeration: true });
    expect(count).toBe(1);
  });

  it('13 & 14. Empty appeal message or excessively long message rejected', async () => {
    const res1 = await request(app)
      .post('/api/support/appeal')
      .set('Authorization', 'Bearer suspended_uid')
      .send({ message: '   ' });

    expect(res1.status).toBe(400);

    const longMessage = 'A'.repeat(2001);
    const res2 = await request(app)
      .post('/api/support/appeal')
      .set('Authorization', 'Bearer suspended_uid')
      .send({ message: longMessage });

    expect(res2.status).toBe(400);
  });

  it('16 & 17. Sending an appeal does NOT change accountStatus', async () => {
    await request(app)
      .post('/api/support/appeal')
      .set('Authorization', 'Bearer suspended_uid')
      .send({ message: 'Unban me' });

    const updatedUser = await UserProfile.findById(suspendedUser._id);
    expect(updatedUser.accountStatus).toBe('suspended');
  });

  it('18. Exact retry with same clientMessageId returns 200 without duplicate message or lastSeq increment', async () => {
    const clientMessageId = crypto.randomUUID();

    const firstRes = await request(app)
      .post('/api/support/appeal')
      .set('Authorization', 'Bearer suspended_uid')
      .send({ message: 'Idempotent appeal', clientMessageId });

    expect(firstRes.status).toBe(201);
    const convId = firstRes.body.conversationId;

    const convAfterFirst = await Conversation.findById(convId);
    expect(convAfterFirst.lastSeq).toBe(1);

    const retryRes = await request(app)
      .post('/api/support/appeal')
      .set('Authorization', 'Bearer suspended_uid')
      .send({ message: 'Idempotent appeal', clientMessageId });

    expect(retryRes.status).toBe(200);
    expect(retryRes.body.conversationId.toString()).toBe(convId.toString());

    const convAfterRetry = await Conversation.findById(convId);
    expect(convAfterRetry.lastSeq).toBe(1);

    const messages = await Message.find({ conversationId: convId });
    expect(messages.length).toBe(1);
    expect(messages[0].seq).toBe(1);
    expect(messages[0].clientMessageId).toBe(clientMessageId);
  });

  it('19. Concurrent duplicate appeal requests result in exactly 1 message and 1 sequence increment', async () => {
    // Ensure conversation exists so both concurrent requests target the same conversationId
    const preConv = await Conversation.create({
      participants: [suspendedUser._id, adminProfile._id],
      isModeration: true,
      lastSeq: 0
    });

    const clientMessageId = crypto.randomUUID();

    const [res1, res2] = await Promise.all([
      request(app)
        .post('/api/support/appeal')
        .set('Authorization', 'Bearer suspended_uid')
        .send({ message: 'Concurrent appeal', clientMessageId }),
      request(app)
        .post('/api/support/appeal')
        .set('Authorization', 'Bearer suspended_uid')
        .send({ message: 'Concurrent appeal', clientMessageId })
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 201]);

    const messages = await Message.find({ conversationId: preConv._id });
    expect(messages.length).toBe(1);
    expect(messages[0].seq).toBe(1);
    expect(messages[0].clientMessageId).toBe(clientMessageId);

    const finalConv = await Conversation.findById(preConv._id);
    expect(finalConv.lastSeq).toBe(1);
  });

  it('20. Reusing clientMessageId with different text returns 409 Conflict', async () => {
    const clientMessageId = crypto.randomUUID();

    const res1 = await request(app)
      .post('/api/support/appeal')
      .set('Authorization', 'Bearer suspended_uid')
      .send({ message: 'First attempt', clientMessageId });
    expect(res1.status).toBe(201);

    const res2 = await request(app)
      .post('/api/support/appeal')
      .set('Authorization', 'Bearer suspended_uid')
      .send({ message: 'Different attempt text', clientMessageId });
    expect(res2.status).toBe(409);
    expect(res2.body.message).toContain('Conflict');
  });

  it('21. Malformed clientMessageId returns 400 Bad Request', async () => {
    const res = await request(app)
      .post('/api/support/appeal')
      .set('Authorization', 'Bearer suspended_uid')
      .send({ message: 'Appeal with bad key', clientMessageId: 'not-a-uuid' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Invalid clientMessageId');
  });

});

