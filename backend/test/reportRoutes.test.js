import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import crypto from 'crypto';
import { connectTestDB, closeTestDB, clearTestDB } from './setup.js';

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
    req.user = { uid: token };
    next();
  }
}));

import reportRoutes from '../src/routes/reportRoutes.js';
import UserProfile from '../src/models/UserProfile.js';
import Conversation from '../src/models/Conversation.js';
import Message from '../src/models/Message.js';
import Report from '../src/models/Report.js';

const app = express();
app.use(express.json());
app.use('/api/reports', reportRoutes);

describe('Report Evidence Snapshot', () => {
  let userA, userB, userC;
  let convAB, convBC;

  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    
    // Create users
    userA = await UserProfile.create({ firebaseUid: 'uidA', displayName: 'User A', email: 'a@a.com', games: [] });
    userB = await UserProfile.create({ firebaseUid: 'uidB', displayName: 'User B', email: 'b@b.com', games: [] });
    userC = await UserProfile.create({ firebaseUid: 'uidC', displayName: 'User C', email: 'c@c.com', games: [] });
    
    // Create conversations
    convAB = await Conversation.create({ participants: [userA._id, userB._id] });
    convBC = await Conversation.create({ participants: [userB._id, userC._id] });
  });

  it('stores exactly 10 messages, oldest to newest, when conversation has 10+ messages', async () => {
    // Create 15 messages in convAB
    const now = Date.now();
    for (let i = 0; i < 15; i++) {
      await Message.create({
        conversationId: convAB._id,
        sender: i % 2 === 0 ? userA._id : userB._id,
        text: `Message ${i}`,
        seq: i + 1,
        clientMessageId: crypto.randomUUID(),
        createdAt: new Date(now + i * 1000)
      });
    }

    const res = await request(app).post('/api/reports')
      .set('Authorization', 'Bearer uidA')
      .send({
        reportedUserId: userB._id.toString(),
        reason: 'Harassment',
        conversationId: convAB._id.toString()
      });

    expect(res.status).toBe(201);
    
    const report = await Report.findOne({ reporter: userA._id });
    expect(report.evidenceMessages).toHaveLength(10);
    
    // Check chronological order (oldest -> newest of the LAST 10)
    // The last 10 messages are indices 5 to 14
    expect(report.evidenceMessages[0].text).toBe('Message 5');
    expect(report.evidenceMessages[9].text).toBe('Message 14');
    expect(report.evidenceMessages[0].timestamp.getTime()).toBeLessThan(report.evidenceMessages[9].timestamp.getTime());
    
    // Ensure properties exist
    expect(report.evidenceMessages[0]).toHaveProperty('senderId');
    expect(report.evidenceMessages[0]).toHaveProperty('text');
    expect(report.evidenceMessages[0]).toHaveProperty('timestamp');
  });

  it('stores all available messages if conversation has fewer than 10 messages', async () => {
    const now = Date.now();
    await Message.create({ conversationId: convAB._id, sender: userA._id, text: 'M1', seq: 1, clientMessageId: crypto.randomUUID(), createdAt: new Date(now) });
    await Message.create({ conversationId: convAB._id, sender: userB._id, text: 'M2', seq: 2, clientMessageId: crypto.randomUUID(), createdAt: new Date(now + 1000) });

    const res = await request(app).post('/api/reports')
      .set('Authorization', 'Bearer uidA')
      .send({
        reportedUserId: userB._id.toString(),
        reason: 'Spam',
        conversationId: convAB._id.toString()
      });

    expect(res.status).toBe(201);
    
    const report = await Report.findOne({ reporter: userA._id });
    expect(report.evidenceMessages).toHaveLength(2);
    expect(report.evidenceMessages[0].text).toBe('M1');
    expect(report.evidenceMessages[1].text).toBe('M2');
  });

  it('stores an empty evidenceMessages array if conversation has zero messages', async () => {
    const res = await request(app).post('/api/reports')
      .set('Authorization', 'Bearer uidA')
      .send({
        reportedUserId: userB._id.toString(),
        reason: 'Spam',
        conversationId: convAB._id.toString()
      });

    expect(res.status).toBe(201);
    
    const report = await Report.findOne({ reporter: userA._id });
    expect(report.evidenceMessages).toEqual([]);
  });

  it('evidence belongs only to the reported conversation', async () => {
    await Message.create({ conversationId: convAB._id, sender: userA._id, text: 'AB Message', seq: 1, clientMessageId: crypto.randomUUID() });
    await Message.create({ conversationId: convBC._id, sender: userB._id, text: 'BC Message', seq: 1, clientMessageId: crypto.randomUUID() });

    const res = await request(app).post('/api/reports')
      .set('Authorization', 'Bearer uidA')
      .send({
        reportedUserId: userB._id.toString(),
        reason: 'Spam',
        conversationId: convAB._id.toString()
      });

    expect(res.status).toBe(201);
    const report = await Report.findOne({ reporter: userA._id });
    expect(report.evidenceMessages).toHaveLength(1);
    expect(report.evidenceMessages[0].text).toBe('AB Message');
  });

  it('cannot create a report using a conversation they are not a participant in', async () => {
    const res = await request(app).post('/api/reports')
      .set('Authorization', 'Bearer uidA')
      .send({
        reportedUserId: userC._id.toString(),
        reason: 'Spam',
        conversationId: convBC._id.toString()
      });

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Cannot report from a conversation you both are not part of');
  });

  it('ensures immutability: new messages added AFTER report creation do not appear in evidenceMessages', async () => {
    await Message.create({ conversationId: convAB._id, sender: userA._id, text: 'Before report', seq: 1, clientMessageId: crypto.randomUUID() });

    const res = await request(app).post('/api/reports')
      .set('Authorization', 'Bearer uidA')
      .send({
        reportedUserId: userB._id.toString(),
        reason: 'Spam',
        conversationId: convAB._id.toString()
      });

    expect(res.status).toBe(201);

    // Add a message AFTER report creation
    await Message.create({ conversationId: convAB._id, sender: userB._id, text: 'After report', seq: 2, clientMessageId: crypto.randomUUID() });

    const report = await Report.findOne({ reporter: userA._id });
    expect(report.evidenceMessages).toHaveLength(1);
    expect(report.evidenceMessages[0].text).toBe('Before report');
  });

  it('preserves existing validation/rate-limiting behavior', async () => {
    await request(app).post('/api/reports')
      .set('Authorization', 'Bearer uidA')
      .send({
        reportedUserId: userB._id.toString(),
        reason: 'Spam'
      });

    // Submitting identical report within 24 hours should fail
    const res = await request(app).post('/api/reports')
      .set('Authorization', 'Bearer uidA')
      .send({
        reportedUserId: userB._id.toString(),
        reason: 'Spam'
      });

    expect(res.status).toBe(429);
    expect(res.body.message).toBe('You have already reported this user for this reason recently');
  });

  it('allows reading an existing report created without evidenceMessages', async () => {
    // Manually create a report omitting evidenceMessages
    await Report.collection.insertOne({
      reporter: userA._id,
      reportedUser: userB._id,
      reason: 'Spam',
      status: 'pending',
      moderationAction: 'none',
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const report = await Report.findOne({ reporter: userA._id });
    expect(report.reason).toBe('Spam');
    // Using Mongoose default `[]` for arrays missing from DB
    expect(report.evidenceMessages).toEqual([]);
  });
});
