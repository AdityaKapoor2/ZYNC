import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import crypto from 'crypto';

import UserProfile from '../src/models/UserProfile.js';
import Conversation from '../src/models/Conversation.js';
import Message from '../src/models/Message.js';
import Connection from '../src/models/Connection.js';
import Report from '../src/models/Report.js';
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
import reportRoutes from '../src/routes/reportRoutes.js';

const app = express();
app.use(express.json());
app.use('/api/chat', chatRoutes);
app.use('/api/reports', reportRoutes);

describe('Chat Message Persistence, Canonical Ordering & Player Reporting Verification', () => {
  let userA, userB, userC, superAdmin;
  let convAB;

  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();

    userA = await UserProfile.create({
      firebaseUid: 'uid-a',
      email: 'a@zync.test',
      displayName: 'Alice',
      role: 'user',
      accountStatus: 'active'
    });

    userB = await UserProfile.create({
      firebaseUid: 'uid-b',
      email: 'b@zync.test',
      displayName: 'Bob',
      role: 'user',
      accountStatus: 'active'
    });

    userC = await UserProfile.create({
      firebaseUid: 'uid-c',
      email: 'c@zync.test',
      displayName: 'Charlie',
      role: 'user',
      accountStatus: 'active'
    });

    superAdmin = await UserProfile.create({
      firebaseUid: 'uid-admin',
      email: 'admin@zync.test',
      displayName: 'Super Admin',
      role: 'super_admin',
      accountStatus: 'active'
    });

    // Establish accepted friend connection between Alice and Bob
    await Connection.create({
      requester: userA._id,
      recipient: userB._id,
      status: 'accepted'
    });

    // Create 1-on-1 conversation
    convAB = await Conversation.create({
      participants: [userA._id, userB._id],
      isModeration: false,
      lastSeq: 0
    });
  });

  describe('1. Message Persistence & Database State Verification', () => {
    it('persists a message with expected conversationId, seq, sender, text and timestamp', async () => {
      const clientMessageId = crypto.randomUUID();
      const text = 'First message from Alice';

      const sendRes = await request(app)
        .post(`/api/chat/conversations/${convAB._id}/messages`)
        .set('Authorization', 'Bearer uid-a')
        .send({ text, clientMessageId });

      expect(sendRes.status).toBe(201);
      expect(sendRes.body).toHaveProperty('_id');
      expect(sendRes.body.seq).toBe(1);
      expect(sendRes.body.clientMessageId).toBe(clientMessageId);
      expect(sendRes.body.text).toBe(text);

      // Verify direct database record
      const dbMsg = await Message.findById(sendRes.body._id);
      expect(dbMsg).not.toBeNull();
      expect(dbMsg.conversationId.toString()).toBe(convAB._id.toString());
      expect(dbMsg.sender.toString()).toBe(userA._id.toString());
      expect(dbMsg.seq).toBe(1);
      expect(dbMsg.text).toBe(text);
      expect(dbMsg.clientMessageId).toBe(clientMessageId);
      expect(dbMsg.createdAt).toBeInstanceOf(Date);

      // Verify conversation metadata updated
      const updatedConv = await Conversation.findById(convAB._id);
      expect(updatedConv.lastSeq).toBe(1);
      expect(updatedConv.lastMessage.toString()).toBe(dbMsg._id.toString());
    });

    it('retrieves persisted messages upon reloading conversation history', async () => {
      // Send 3 messages
      const msgTexts = ['Hello', 'How are you?', 'Ready for tournament'];
      for (const t of msgTexts) {
        await request(app)
          .post(`/api/chat/conversations/${convAB._id}/messages`)
          .set('Authorization', 'Bearer uid-a')
          .send({ text: t, clientMessageId: crypto.randomUUID() });
      }

      // Reload conversation via GET
      const getRes = await request(app)
        .get(`/api/chat/conversations/${convAB._id}/messages`)
        .set('Authorization', 'Bearer uid-b');

      expect(getRes.status).toBe(200);
      expect(getRes.body.messages).toHaveLength(3);
      expect(getRes.body.lastSeq).toBe(3);

      // Verify ascending seq order (lowest seq at top, highest seq at bottom)
      expect(getRes.body.messages[0].seq).toBe(1);
      expect(getRes.body.messages[0].text).toBe('Hello');
      expect(getRes.body.messages[1].seq).toBe(2);
      expect(getRes.body.messages[1].text).toBe('How are you?');
      expect(getRes.body.messages[2].seq).toBe(3);
      expect(getRes.body.messages[2].text).toBe('Ready for tournament');
    });

    it('ensures failed sends are rejected and never falsely persisted in database', async () => {
      // Attempt empty text
      const emptyRes = await request(app)
        .post(`/api/chat/conversations/${convAB._id}/messages`)
        .set('Authorization', 'Bearer uid-a')
        .send({ text: '   ', clientMessageId: crypto.randomUUID() });
      expect(emptyRes.status).toBe(400);

      // Attempt invalid UUID
      const badUuidRes = await request(app)
        .post(`/api/chat/conversations/${convAB._id}/messages`)
        .set('Authorization', 'Bearer uid-a')
        .send({ text: 'Valid text', clientMessageId: 'not-a-valid-uuid' });
      expect(badUuidRes.status).toBe(400);

      // Attempt send from non-participant userC
      const nonParticipantRes = await request(app)
        .post(`/api/chat/conversations/${convAB._id}/messages`)
        .set('Authorization', 'Bearer uid-c')
        .send({ text: 'Intrusion', clientMessageId: crypto.randomUUID() });
      expect(nonParticipantRes.status).toBe(403);

      // Verify database contains zero messages and lastSeq remains 0
      const count = await Message.countDocuments({ conversationId: convAB._id });
      expect(count).toBe(0);
      const conv = await Conversation.findById(convAB._id);
      expect(conv.lastSeq).toBe(0);
    });
  });

  describe('2. Canonical Sequence-Based History Ordering', () => {
    it('always returns messages strictly in ascending sequence order', async () => {
      // Alice and Bob take turns sending 5 messages
      for (let i = 1; i <= 5; i++) {
        const senderUid = i % 2 === 1 ? 'uid-a' : 'uid-b';
        await request(app)
          .post(`/api/chat/conversations/${convAB._id}/messages`)
          .set('Authorization', `Bearer ${senderUid}`)
          .send({ text: `Message #${i}`, clientMessageId: crypto.randomUUID() });
      }

      const res = await request(app)
        .get(`/api/chat/conversations/${convAB._id}/messages`)
        .set('Authorization', 'Bearer uid-a');

      expect(res.status).toBe(200);
      const seqs = res.body.messages.map(m => m.seq);
      expect(seqs).toEqual([1, 2, 3, 4, 5]);

      // Incremental recovery with afterSeq=2 returns seqs 3, 4, 5 in ascending order
      const recoveryRes = await request(app)
        .get(`/api/chat/conversations/${convAB._id}/messages?afterSeq=2`)
        .set('Authorization', 'Bearer uid-b');
      expect(recoveryRes.status).toBe(200);
      expect(recoveryRes.body.messages.map(m => m.seq)).toEqual([3, 4, 5]);

      // Historical pagination with beforeSeq=4 returns seqs 1, 2, 3 in ascending order
      const paginationRes = await request(app)
        .get(`/api/chat/conversations/${convAB._id}/messages?beforeSeq=4`)
        .set('Authorization', 'Bearer uid-a');
      expect(paginationRes.status).toBe(200);
      expect(paginationRes.body.messages.map(m => m.seq)).toEqual([1, 2, 3]);
    });
  });

  describe('3. Player Reporting & Evidence Snapshot Verification', () => {
    it('submits a report with conversation evidence sourced from persisted messages in chronological order', async () => {
      // Alice sends 3 messages, Bob sends toxic message
      await request(app)
        .post(`/api/chat/conversations/${convAB._id}/messages`)
        .set('Authorization', 'Bearer uid-a')
        .send({ text: 'Good game!', clientMessageId: crypto.randomUUID() });

      await request(app)
        .post(`/api/chat/conversations/${convAB._id}/messages`)
        .set('Authorization', 'Bearer uid-b')
        .send({ text: 'Toxic harassment content', clientMessageId: crypto.randomUUID() });

      await request(app)
        .post(`/api/chat/conversations/${convAB._id}/messages`)
        .set('Authorization', 'Bearer uid-a')
        .send({ text: 'Please stop', clientMessageId: crypto.randomUUID() });

      // Alice reports Bob with conversation context
      const reportRes = await request(app)
        .post('/api/reports')
        .set('Authorization', 'Bearer uid-a')
        .send({
          reportedUserId: userB._id.toString(),
          reason: 'Harassment',
          description: 'Bob was sending abusive messages',
          conversationId: convAB._id.toString()
        });

      expect(reportRes.status).toBe(201);
      expect(reportRes.body.message).toContain('Report submitted successfully');

      // Verify report in database
      const report = await Report.findOne({ reporter: userA._id, reportedUser: userB._id });
      expect(report).not.toBeNull();
      expect(report.status).toBe('pending');
      expect(report.conversationId.toString()).toBe(convAB._id.toString());
      expect(report.evidenceMessages).toHaveLength(3);

      // Chronological order: oldest to newest
      expect(report.evidenceMessages[0].text).toBe('Good game!');
      expect(report.evidenceMessages[0].senderId.toString()).toBe(userA._id.toString());
      expect(report.evidenceMessages[1].text).toBe('Toxic harassment content');
      expect(report.evidenceMessages[1].senderId.toString()).toBe(userB._id.toString());
      expect(report.evidenceMessages[2].text).toBe('Please stop');
      expect(report.evidenceMessages[2].senderId.toString()).toBe(userA._id.toString());
    });

    it('rejects reporting with conversation context when reporter or reported is not a participant', async () => {
      const unauthorizedReportRes = await request(app)
        .post('/api/reports')
        .set('Authorization', 'Bearer uid-c') // Charlie is not in convAB
        .send({
          reportedUserId: userB._id.toString(),
          reason: 'Harassment',
          conversationId: convAB._id.toString()
        });

      expect(unauthorizedReportRes.status).toBe(403);
      expect(unauthorizedReportRes.body.message).toContain('Cannot report from a conversation you both are not part of');
    });
  });
});
