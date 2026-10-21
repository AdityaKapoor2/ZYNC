import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

import UserProfile from '../src/models/UserProfile.js';
import Report from '../src/models/Report.js';
import Conversation from '../src/models/Conversation.js';
import Message from '../src/models/Message.js';

// Mock auth exactly as it works in adminRoutes.test.js
vi.mock('../src/middleware/authMiddleware.js', () => ({
  verifyToken: (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    req.user = { uid: token };
    next();
  }
}));

import adminRoutes from '../src/routes/adminRoutes.js';
import chatRoutes from '../src/routes/chatRoutes.js';

const app = express();
app.use(express.json());
app.use('/api/admin', adminRoutes);
app.use('/api/chat', chatRoutes);

let replSet;
let adminProfile, user1, user2, report1;

describe('Report Messaging (Admin)', () => {
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
    await Report.deleteMany({});
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

    user1 = await UserProfile.create({
      firebaseUid: 'user1_uid',
      email: 'user1@example.com',
      displayName: 'User 1 (Reporter)',
      role: 'user',
      accountStatus: 'active',
      games: []
    });

    user2 = await UserProfile.create({
      firebaseUid: 'user2_uid',
      email: 'user2@example.com',
      displayName: 'User 2 (Reported)',
      role: 'user',
      accountStatus: 'active',
      games: []
    });

    report1 = await Report.create({
      reporter: user1._id,
      reportedUser: user2._id,
      reason: 'Harassment',
      status: 'pending'
    });
  });

  it('A. Super Admin can message reporter', async () => {
    const res = await request(app)
      .post(`/api/admin/reports/${report1._id}/message`)
      .set('Authorization', 'Bearer admin_uid')
      .send({ recipientType: 'reporter', message: 'Hello Reporter' });
      
    expect(res.status).toBe(201);
    expect(res.body.conversationId).toBeDefined();

    const conversation = await Conversation.findById(res.body.conversationId);
    expect(conversation.participants.length).toBe(2);
    expect(conversation.participants).toContainEqual(adminProfile._id);
    expect(conversation.participants).toContainEqual(user1._id);

    const message = await Message.findOne({ conversationId: conversation._id });
    expect(message.text).toBe('Hello Reporter');
    expect(message.sender.toString()).toBe(adminProfile._id.toString());
  });

  it('B. Super Admin can message reported user', async () => {
    const res = await request(app)
      .post(`/api/admin/reports/${report1._id}/message`)
      .set('Authorization', 'Bearer admin_uid')
      .send({ recipientType: 'reportedUser', message: 'Hello Reported' });
      
    expect(res.status).toBe(201);
    
    const message = await Message.findOne({ sender: adminProfile._id });
    expect(message.text).toBe('Hello Reported');
    
    const conversation = await Conversation.findById(res.body.conversationId);
    expect(conversation.participants).toContainEqual(user2._id);
  });

  it('C. Existing conversation is reused', async () => {
    const res1 = await request(app)
      .post(`/api/admin/reports/${report1._id}/message`)
      .set('Authorization', 'Bearer admin_uid')
      .send({ recipientType: 'reporter', message: 'First' });
      
    const res2 = await request(app)
      .post(`/api/admin/reports/${report1._id}/message`)
      .set('Authorization', 'Bearer admin_uid')
      .send({ recipientType: 'reporter', message: 'Second' });
      
    expect(res1.body.conversationId).toBe(res2.body.conversationId);
    
    const count = await Conversation.countDocuments();
    expect(count).toBe(1);
    
    const messages = await Message.find({ conversationId: res1.body.conversationId });
    expect(messages.length).toBe(2);
  });

  it('H. Normal user cannot send direct chat messages to Super Admin in report conversation', async () => {
    const adminRes = await request(app)
      .post(`/api/admin/reports/${report1._id}/message`)
      .set('Authorization', 'Bearer admin_uid')
      .send({ recipientType: 'reporter', message: 'Hello' });
      
    const convId = adminRes.body.conversationId;

    const userRes = await request(app)
      .post(`/api/chat/conversations/${convId}/messages`)
      .set('Authorization', 'Bearer user1_uid')
      .send({ text: 'Reply from user' });

    expect(userRes.status).toBe(403);
    expect(userRes.body.message).toBe('Direct chat with Super Admin is not permitted');
  });

  it('I. Normal user receives 403 when calling admin messaging endpoint', async () => {
    const res = await request(app)
      .post(`/api/admin/reports/${report1._id}/message`)
      .set('Authorization', 'Bearer user1_uid')
      .send({ recipientType: 'reporter', message: 'Hack' });
      
    expect(res.status).toBe(403);
  });

  it('L. Invalid recipientType rejected', async () => {
    const res = await request(app)
      .post(`/api/admin/reports/${report1._id}/message`)
      .set('Authorization', 'Bearer admin_uid')
      .send({ recipientType: 'someone_else', message: 'Hack' });
      
    expect(res.status).toBe(400);
  });

  it('M. Empty message rejected', async () => {
    const res = await request(app)
      .post(`/api/admin/reports/${report1._id}/message`)
      .set('Authorization', 'Bearer admin_uid')
      .send({ recipientType: 'reporter', message: '   ' });
      
    expect(res.status).toBe(400);
  });

});
