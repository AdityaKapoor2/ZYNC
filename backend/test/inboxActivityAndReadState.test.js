import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import crypto from 'crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

import UserProfile from '../src/models/UserProfile.js';
import Conversation from '../src/models/Conversation.js';
import Message from '../src/models/Message.js';
import Connection from '../src/models/Connection.js';
import Report from '../src/models/Report.js';

// Mock auth middleware matching test suite conventions
vi.mock('../src/middleware/authMiddleware.js', () => ({
  verifyToken: (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    req.user = { uid: token };
    next();
  }
}));

// Mock socket.io config to inspect emitted events
const mockIO = {
  toRooms: [],
  emittedEvents: [],
  to(room) {
    this.toRooms.push(room);
    return this;
  },
  emit(event, data) {
    this.emittedEvents.push({ event, data, rooms: [...this.toRooms] });
    this.toRooms = [];
  },
  reset() {
    this.toRooms = [];
    this.emittedEvents = [];
  }
};

vi.mock('../src/config/socket.js', () => ({
  getIO: () => mockIO
}));

import chatRoutes from '../src/routes/chatRoutes.js';
import adminRoutes from '../src/routes/adminRoutes.js';

const app = express();
app.use(express.json());
app.use('/api/chat', chatRoutes);
app.use('/api/admin', adminRoutes);

describe('Checkpoint B1: Receive-Only Inbox & Persistent Read Tracking', () => {
  let replSet;
  let userA, userB, userC, adminUser;
  let friendConnection;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    mockIO.reset();
    await UserProfile.deleteMany({});
    await Conversation.deleteMany({});
    await Message.deleteMany({});
    await Connection.deleteMany({});
    await Report.deleteMany({});

    userA = await UserProfile.create({
      firebaseUid: 'userA_uid',
      email: 'userA@zync.gg',
      displayName: 'AlicePlayer',
      role: 'user',
      accountStatus: 'active',
      games: []
    });

    userB = await UserProfile.create({
      firebaseUid: 'userB_uid',
      email: 'userB@zync.gg',
      displayName: 'BobPlayer',
      role: 'user',
      accountStatus: 'active',
      games: []
    });

    userC = await UserProfile.create({
      firebaseUid: 'userC_uid',
      email: 'userC@zync.gg',
      displayName: 'CharliePlayer',
      role: 'user',
      accountStatus: 'active',
      games: []
    });

    adminUser = await UserProfile.create({
      firebaseUid: 'admin_uid',
      email: 'admin@zync.gg',
      displayName: 'AdminSuper',
      role: 'super_admin',
      accountStatus: 'active',
      games: []
    });

    // Establish accepted connection between Alice and Bob
    friendConnection = await Connection.create({
      requester: userA._id,
      recipient: userB._id,
      status: 'accepted'
    });
  });

  describe('1. Receive-Only Inbox Mechanics', () => {
    it('User B receives incoming activity, while User A receives NO Inbox activity for their own outgoing message', async () => {
      // 1. User A starts a conversation and sends a message to User B
      const convRes = await request(app)
        .post(`/api/chat/conversations/${userB._id}`)
        .set('Authorization', `Bearer ${userA.firebaseUid}`);
      expect(convRes.status).toBe(200);
      const conversationId = convRes.body._id;

      const sendRes = await request(app)
        .post(`/api/chat/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${userA.firebaseUid}`)
        .send({
          text: 'Hey Bob, secret game strategy!',
          clientMessageId: crypto.randomUUID()
        });
      expect(sendRes.status).toBe(201);

      // 2. User B (recipient) checks Inbox -> has 1 activity item
      const inboxB = await request(app)
        .get('/api/chat/inbox')
        .set('Authorization', `Bearer ${userB.firebaseUid}`);
      expect(inboxB.status).toBe(200);
      expect(inboxB.body).toHaveLength(1);

      const itemB = inboxB.body[0];
      expect(itemB._id.toString()).toBe(conversationId.toString());
      expect(itemB.isUnread).toBe(true);

      // Verify safe metadata for frontend display
      const senderInItem = itemB.participants.find(p => p._id.toString() === userA._id.toString());
      expect(senderInItem).toBeDefined();
      expect(senderInItem.displayName).toBe('AlicePlayer');

      // 3. User A (sender) checks Inbox -> MUST have 0 items (never receive Inbox activity for own message)
      const inboxA = await request(app)
        .get('/api/chat/inbox')
        .set('Authorization', `Bearer ${userA.firebaseUid}`);
      expect(inboxA.status).toBe(200);
      expect(inboxA.body).toHaveLength(0);

      // 4. Full conversation history endpoint GET /api/chat/conversations still returns the conversation for both
      const convsA = await request(app)
        .get('/api/chat/conversations')
        .set('Authorization', `Bearer ${userA.firebaseUid}`);
      expect(convsA.status).toBe(200);
      expect(convsA.body).toHaveLength(1);

      const convsB = await request(app)
        .get('/api/chat/conversations')
        .set('Authorization', `Bearer ${userB.firebaseUid}`);
      expect(convsB.status).toBe(200);
      expect(convsB.body).toHaveLength(1);
    });

    it('Privacy Guarantee: Never exposes private message body in Inbox response for friend messages', async () => {
      const convRes = await request(app)
        .post(`/api/chat/conversations/${userB._id}`)
        .set('Authorization', `Bearer ${userA.firebaseUid}`);
      const conversationId = convRes.body._id;

      const secretText = 'CONFIDENTIAL_DISCORD_TOKEN_12345';
      await request(app)
        .post(`/api/chat/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${userA.firebaseUid}`)
        .send({
          text: secretText,
          clientMessageId: crypto.randomUUID()
        });

      const inboxB = await request(app)
        .get('/api/chat/inbox')
        .set('Authorization', `Bearer ${userB.firebaseUid}`);
      expect(inboxB.status).toBe(200);

      const item = inboxB.body[0];
      // Stringified response must not leak secretText anywhere in the JSON payload
      const rawPayload = JSON.stringify(inboxB.body);
      expect(rawPayload).not.toContain(secretText);

      // lastMessage must have omitted text and generic activityText
      expect(item.lastMessage.text).toBeUndefined();
      expect(item.lastMessage.activityText).toBe('Just messaged you');
      expect(item.lastMessage.seq).toBe(1);
    });

    it('Subsequent incoming message updates existing conversation activity without producing duplicate items', async () => {
      const convRes = await request(app)
        .post(`/api/chat/conversations/${userB._id}`)
        .set('Authorization', `Bearer ${userA.firebaseUid}`);
      const conversationId = convRes.body._id;

      // First message
      await request(app)
        .post(`/api/chat/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${userA.firebaseUid}`)
        .send({ text: 'Message 1', clientMessageId: crypto.randomUUID() });

      // Second message
      await request(app)
        .post(`/api/chat/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${userA.firebaseUid}`)
        .send({ text: 'Message 2', clientMessageId: crypto.randomUUID() });

      const inboxB = await request(app)
        .get('/api/chat/inbox')
        .set('Authorization', `Bearer ${userB.firebaseUid}`);
      expect(inboxB.status).toBe(200);
      expect(inboxB.body).toHaveLength(1);
      expect(inboxB.body[0].lastSeq).toBe(2);
      expect(inboxB.body[0].lastMessage.seq).toBe(2);
    });

    it('Official/moderation message preserves notice text for recipient compatibility', async () => {
      // Super Admin creates a moderation conversation with userB
      const modConv = await Conversation.create({
        participants: [adminUser._id, userB._id],
        isModeration: true,
        lastSeq: 1
      });

      const adminMsg = await Message.create({
        conversationId: modConv._id,
        sender: adminUser._id,
        senderRole: 'admin',
        senderDisplayName: 'ZYNC Super Admin',
        text: 'Action required on your account.',
        seq: 1,
        clientMessageId: crypto.randomUUID()
      });

      modConv.lastMessage = adminMsg._id;
      modConv.lastMessageAt = adminMsg.createdAt;
      await modConv.save();

      const inboxB = await request(app)
        .get('/api/chat/inbox')
        .set('Authorization', `Bearer ${userB.firebaseUid}`);
      expect(inboxB.status).toBe(200);
      expect(inboxB.body).toHaveLength(1);

      const noticeItem = inboxB.body[0];
      expect(noticeItem.isModeration).toBe(true);
      expect(noticeItem.lastMessage).toBeDefined();
      expect(noticeItem.lastMessage.text).toBe('Action required on your account.');
      expect(noticeItem.lastMessage.senderRole).toBe('admin');
      expect(noticeItem.lastMessage.senderDisplayName).toBe('ZYNC Super Admin');
    });
  });

  describe('2. Persistent Per-User Read Tracking & Mark-as-Read Endpoint', () => {
    it('Recipient can mark conversation as read, clearing unread status', async () => {
      const convRes = await request(app)
        .post(`/api/chat/conversations/${userB._id}`)
        .set('Authorization', `Bearer ${userA.firebaseUid}`);
      const conversationId = convRes.body._id;

      await request(app)
        .post(`/api/chat/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${userA.firebaseUid}`)
        .send({ text: 'Hello Bob', clientMessageId: crypto.randomUUID() });

      // Before read: isUnread is true for Bob
      let inboxB = await request(app)
        .get('/api/chat/inbox')
        .set('Authorization', `Bearer ${userB.firebaseUid}`);
      expect(inboxB.body[0].isUnread).toBe(true);

      // Bob marks conversation read
      const markRes = await request(app)
        .post(`/api/chat/conversations/${conversationId}/read`)
        .set('Authorization', `Bearer ${userB.firebaseUid}`)
        .send();
      expect(markRes.status).toBe(200);
      expect(markRes.body).toEqual({
        conversationId: conversationId.toString(),
        lastReadSeq: 1,
        lastSeq: 1,
        isUnread: false
      });

      // After read: isUnread is false in Bob's Inbox
      inboxB = await request(app)
        .get('/api/chat/inbox')
        .set('Authorization', `Bearer ${userB.firebaseUid}`);
      expect(inboxB.body[0].isUnread).toBe(false);
      expect(inboxB.body[0].lastReadSeq).toBe(1);
    });

    it('Later incoming message makes conversation unread again for recipient', async () => {
      const convRes = await request(app)
        .post(`/api/chat/conversations/${userB._id}`)
        .set('Authorization', `Bearer ${userA.firebaseUid}`);
      const conversationId = convRes.body._id;

      await request(app)
        .post(`/api/chat/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${userA.firebaseUid}`)
        .send({ text: 'Msg 1', clientMessageId: crypto.randomUUID() });

      // Bob marks read up to seq 1
      await request(app)
        .post(`/api/chat/conversations/${conversationId}/read`)
        .set('Authorization', `Bearer ${userB.firebaseUid}`);

      // Alice sends Msg 2
      await request(app)
        .post(`/api/chat/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${userA.firebaseUid}`)
        .send({ text: 'Msg 2', clientMessageId: crypto.randomUUID() });

      const inboxB = await request(app)
        .get('/api/chat/inbox')
        .set('Authorization', `Bearer ${userB.firebaseUid}`);
      expect(inboxB.body[0].isUnread).toBe(true);
      expect(inboxB.body[0].lastReadSeq).toBe(1);
      expect(inboxB.body[0].lastSeq).toBe(2);
    });

    it('Monotonic read progress: read sequence cannot move backward', async () => {
      const convRes = await request(app)
        .post(`/api/chat/conversations/${userB._id}`)
        .set('Authorization', `Bearer ${userA.firebaseUid}`);
      const conversationId = convRes.body._id;

      await request(app)
        .post(`/api/chat/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${userA.firebaseUid}`)
        .send({ text: 'Msg 1', clientMessageId: crypto.randomUUID() });
      await request(app)
        .post(`/api/chat/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${userA.firebaseUid}`)
        .send({ text: 'Msg 2', clientMessageId: crypto.randomUUID() });

      // Mark read up to seq 2
      await request(app)
        .post(`/api/chat/conversations/${conversationId}/read`)
        .set('Authorization', `Bearer ${userB.firebaseUid}`)
        .send({ readSeq: 2 });

      // Try to mark read with a backward sequence (readSeq: 1)
      const backwardRes = await request(app)
        .post(`/api/chat/conversations/${conversationId}/read`)
        .set('Authorization', `Bearer ${userB.firebaseUid}`)
        .send({ readSeq: 1 });
      expect(backwardRes.status).toBe(200);
      // Stays at 2
      expect(backwardRes.body.lastReadSeq).toBe(2);
      expect(backwardRes.body.isUnread).toBe(false);
    });

    it('Validates client-provided readSeq against conversation lastSeq', async () => {
      const convRes = await request(app)
        .post(`/api/chat/conversations/${userB._id}`)
        .set('Authorization', `Bearer ${userA.firebaseUid}`);
      const conversationId = convRes.body._id;

      await request(app)
        .post(`/api/chat/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${userA.firebaseUid}`)
        .send({ text: 'Msg 1', clientMessageId: crypto.randomUUID() });

      // Negative sequence
      const negRes = await request(app)
        .post(`/api/chat/conversations/${conversationId}/read`)
        .set('Authorization', `Bearer ${userB.firebaseUid}`)
        .send({ readSeq: -1 });
      expect(negRes.status).toBe(400);

      // Future sequence beyond conversation lastSeq
      const futureRes = await request(app)
        .post(`/api/chat/conversations/${conversationId}/read`)
        .set('Authorization', `Bearer ${userB.firebaseUid}`)
        .send({ readSeq: 999 });
      expect(futureRes.status).toBe(400);
      expect(futureRes.body.message).toContain('cannot exceed conversation lastSeq');
    });

    it('Authorization & Non-disclosure: Nonparticipants and malformed IDs return safe errors', async () => {
      const convRes = await request(app)
        .post(`/api/chat/conversations/${userB._id}`)
        .set('Authorization', `Bearer ${userA.firebaseUid}`);
      const conversationId = convRes.body._id;

      // Malformed ID
      const malformedRes = await request(app)
        .post('/api/chat/conversations/not-an-id/read')
        .set('Authorization', `Bearer ${userA.firebaseUid}`);
      expect(malformedRes.status).toBe(400);

      // Nonexistent conversation
      const nonExistentId = new mongoose.Types.ObjectId();
      const nonExistentRes = await request(app)
        .post(`/api/chat/conversations/${nonExistentId}/read`)
        .set('Authorization', `Bearer ${userA.firebaseUid}`);
      expect(nonExistentRes.status).toBe(404);

      // Unrelated user C attempting to mark Alice & Bob's conversation as read
      const unauthorizedRes = await request(app)
        .post(`/api/chat/conversations/${conversationId}/read`)
        .set('Authorization', `Bearer ${userC.firebaseUid}`);
      // Returns 404 to avoid disclosing existence of unrelated conversations
      expect(unauthorizedRes.status).toBe(404);
    });

    it('Migration-free compatibility rule: Legacy conversations with uninitialized readState behave safely', async () => {
      // Create a legacy conversation with no readState field
      const legacyConv = await Conversation.create({
        participants: [userA._id, userB._id],
        isModeration: false,
        lastSeq: 5
      });

      const legacyMsg = await Message.create({
        conversationId: legacyConv._id,
        sender: userA._id,
        senderRole: 'user',
        text: 'Legacy secret message',
        seq: 5,
        clientMessageId: crypto.randomUUID()
      });

      legacyConv.lastMessage = legacyMsg._id;
      legacyConv.lastMessageAt = legacyMsg.createdAt;
      // Explicitly unset readState to simulate legacy database record
      legacyConv.readState = undefined;
      await legacyConv.save();

      // Recipient B checks inbox:
      // Legacy compatibility rule treats incoming message at frontier as unread (lastReadSeq = lastSeq - 1 = 4)
      const inboxB = await request(app)
        .get('/api/chat/inbox')
        .set('Authorization', `Bearer ${userB.firebaseUid}`);
      expect(inboxB.status).toBe(200);
      expect(inboxB.body).toHaveLength(1);
      expect(inboxB.body[0].isUnread).toBe(true);
      expect(inboxB.body[0].lastReadSeq).toBe(4);
      expect(inboxB.body[0].lastMessage.activityText).toBe('Just messaged you');
      expect(inboxB.body[0].lastMessage.text).toBeUndefined();

      // Recipient B marks as read
      const markRes = await request(app)
        .post(`/api/chat/conversations/${legacyConv._id}/read`)
        .set('Authorization', `Bearer ${userB.firebaseUid}`);
      expect(markRes.status).toBe(200);
      expect(markRes.body.lastReadSeq).toBe(5);
      expect(markRes.body.isUnread).toBe(false);
    });
  });

  describe('3. Realtime Socket Event Targeting', () => {
    it('Emits inbox:activity ONLY to the recipient room and NEVER to the sender room', async () => {
      const convRes = await request(app)
        .post(`/api/chat/conversations/${userB._id}`)
        .set('Authorization', `Bearer ${userA.firebaseUid}`);
      const conversationId = convRes.body._id;

      mockIO.reset();

      await request(app)
        .post(`/api/chat/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${userA.firebaseUid}`)
        .send({ text: 'Realtime check', clientMessageId: crypto.randomUUID() });

      // Find emitted events
      const chatMessageEvent = mockIO.emittedEvents.find(e => e.event === 'chat:message');
      const inboxActivityEvent = mockIO.emittedEvents.find(e => e.event === 'inbox:activity');

      // chat:message is delivered to both user rooms for conversational sync
      expect(chatMessageEvent).toBeDefined();
      expect(chatMessageEvent.rooms).toContain(`user:${userB._id}`);
      expect(chatMessageEvent.rooms).toContain(`user:${userA._id}`);

      // inbox:activity is delivered ONLY to the recipient room
      expect(inboxActivityEvent).toBeDefined();
      expect(inboxActivityEvent.rooms).toContain(`user:${userB._id}`);
      expect(inboxActivityEvent.rooms).not.toContain(`user:${userA._id}`);

      // inbox:activity payload contains no private text
      expect(inboxActivityEvent.data.activityText).toBe('Just messaged you');
      expect(inboxActivityEvent.data.text).toBeUndefined();
      expect(inboxActivityEvent.data.isUnread).toBe(true);
      expect(inboxActivityEvent.data.sender.toString()).toBe(userA._id.toString());
    });
  });

  describe('4. Realtime Read Receipts (chat:read)', () => {
    it('1. Authorized participant marking messages as read emits chat:read to the other participant', async () => {
      const convRes = await request(app)
        .post(`/api/chat/conversations/${userB._id}`)
        .set('Authorization', `Bearer ${userA.firebaseUid}`);
      const conversationId = convRes.body._id;

      await request(app)
        .post(`/api/chat/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${userA.firebaseUid}`)
        .send({ text: 'Hello Bob', clientMessageId: crypto.randomUUID() });

      mockIO.reset();

      const markRes = await request(app)
        .post(`/api/chat/conversations/${conversationId}/read`)
        .set('Authorization', `Bearer ${userB.firebaseUid}`)
        .send({ readSeq: 1 });

      expect(markRes.status).toBe(200);
      expect(markRes.body.lastReadSeq).toBe(1);

      const readEvent = mockIO.emittedEvents.find(e => e.event === 'chat:read');
      expect(readEvent).toBeDefined();
      expect(readEvent.rooms).toContain(`user:${userA._id}`);
      expect(readEvent.rooms).not.toContain(`user:${userB._id}`);
      expect(readEvent.data).toEqual({
        conversationId: conversationId.toString(),
        readerId: userB._id.toString(),
        lastReadSeq: 1
      });
    });

    it('2. Nonparticipant cannot read conversation or trigger chat:read event', async () => {
      const convRes = await request(app)
        .post(`/api/chat/conversations/${userB._id}`)
        .set('Authorization', `Bearer ${userA.firebaseUid}`);
      const conversationId = convRes.body._id;

      mockIO.reset();

      const unauthorizedRes = await request(app)
        .post(`/api/chat/conversations/${conversationId}/read`)
        .set('Authorization', `Bearer ${userC.firebaseUid}`)
        .send({ readSeq: 1 });

      expect(unauthorizedRes.status).toBe(404);
      expect(mockIO.emittedEvents.filter(e => e.event === 'chat:read')).toHaveLength(0);
    });

    it('3. Forged readerId in payload is ignored; reader identity is derived from authenticated profile', async () => {
      const convRes = await request(app)
        .post(`/api/chat/conversations/${userB._id}`)
        .set('Authorization', `Bearer ${userA.firebaseUid}`);
      const conversationId = convRes.body._id;

      await request(app)
        .post(`/api/chat/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${userA.firebaseUid}`)
        .send({ text: 'Check forged reader', clientMessageId: crypto.randomUUID() });

      mockIO.reset();

      // Bob tries to forge readerId as User A or User C
      const markRes = await request(app)
        .post(`/api/chat/conversations/${conversationId}/read`)
        .set('Authorization', `Bearer ${userB.firebaseUid}`)
        .send({ readSeq: 1, readerId: userC._id.toString() });

      expect(markRes.status).toBe(200);

      const readEvent = mockIO.emittedEvents.find(e => e.event === 'chat:read');
      expect(readEvent).toBeDefined();
      expect(readEvent.data.readerId).toBe(userB._id.toString());
      expect(readEvent.data.readerId).not.toBe(userC._id.toString());
    });

    it('4. Older read request cannot move lastReadSeq backward', async () => {
      const convRes = await request(app)
        .post(`/api/chat/conversations/${userB._id}`)
        .set('Authorization', `Bearer ${userA.firebaseUid}`);
      const conversationId = convRes.body._id;

      await request(app)
        .post(`/api/chat/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${userA.firebaseUid}`)
        .send({ text: 'Msg 1', clientMessageId: crypto.randomUUID() });
      await request(app)
        .post(`/api/chat/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${userA.firebaseUid}`)
        .send({ text: 'Msg 2', clientMessageId: crypto.randomUUID() });

      // Mark up to seq 2
      await request(app)
        .post(`/api/chat/conversations/${conversationId}/read`)
        .set('Authorization', `Bearer ${userB.firebaseUid}`)
        .send({ readSeq: 2 });

      mockIO.reset();

      // Attempt to mark backward (readSeq: 1)
      const backwardRes = await request(app)
        .post(`/api/chat/conversations/${conversationId}/read`)
        .set('Authorization', `Bearer ${userB.firebaseUid}`)
        .send({ readSeq: 1 });

      expect(backwardRes.status).toBe(200);
      expect(backwardRes.body.lastReadSeq).toBe(2);

      // Monotonic guard: backward / no-op read emits neither chat:read nor inbox:read
      expect(mockIO.emittedEvents.find(e => e.event === 'chat:read')).toBeUndefined();
      expect(mockIO.emittedEvents.find(e => e.event === 'inbox:read')).toBeUndefined();

      // Verify persisted state remains at frontier 2
      const conv = await Conversation.findById(conversationId);
      const bEntry = conv.readState.find(r => r.user.toString() === userB._id.toString());
      expect(bEntry.lastReadSeq).toBe(2);
    });

    it('5. Database failure during read update returns HTTP 500 and emits no chat:read event', async () => {
      const convRes = await request(app)
        .post(`/api/chat/conversations/${userB._id}`)
        .set('Authorization', `Bearer ${userA.firebaseUid}`);
      const conversationId = convRes.body._id;

      await request(app)
        .post(`/api/chat/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${userA.firebaseUid}`)
        .send({ text: 'Db fail check', clientMessageId: crypto.randomUUID() });

      mockIO.reset();

      const updateSpy = vi.spyOn(Conversation, 'findOneAndUpdate').mockImplementationOnce(() => {
        throw new Error('SIMULATED_DB_FAILURE');
      });

      const res = await request(app)
        .post(`/api/chat/conversations/${conversationId}/read`)
        .set('Authorization', `Bearer ${userB.firebaseUid}`)
        .send({ readSeq: 1 });

      updateSpy.mockRestore();

      expect(res.status).toBe(500);
      expect(mockIO.emittedEvents.filter(e => e.event === 'chat:read')).toHaveLength(0);
    });

    it('6. Socket emission failure does not turn a successful read-state update into HTTP 500', async () => {
      const convRes = await request(app)
        .post(`/api/chat/conversations/${userB._id}`)
        .set('Authorization', `Bearer ${userA.firebaseUid}`);
      const conversationId = convRes.body._id;

      await request(app)
        .post(`/api/chat/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${userA.firebaseUid}`)
        .send({ text: 'Hello', clientMessageId: crypto.randomUUID() });

      mockIO.reset();

      const originalEmit = mockIO.emit.bind(mockIO);
      vi.spyOn(mockIO, 'emit').mockImplementationOnce(() => {
        throw new Error('SIMULATED_SOCKET_EMIT_FAILURE');
      });

      const res = await request(app)
        .post(`/api/chat/conversations/${conversationId}/read`)
        .set('Authorization', `Bearer ${userB.firebaseUid}`)
        .send({ readSeq: 1 });

      mockIO.emit = originalEmit;

      expect(res.status).toBe(200);
      expect(res.body.lastReadSeq).toBe(1);

      // Verify DB was updated
      const conv = await Conversation.findById(conversationId);
      const bEntry = conv.readState.find(r => r.user.toString() === userB._id.toString());
      expect(bEntry.lastReadSeq).toBe(1);
    });

    it('7. Reader-side multi-tab synchronization emits inbox:read to reader room with correct payload', async () => {
      const convRes = await request(app)
        .post(`/api/chat/conversations/${userB._id}`)
        .set('Authorization', `Bearer ${userA.firebaseUid}`);
      const conversationId = convRes.body._id;

      await request(app)
        .post(`/api/chat/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${userA.firebaseUid}`)
        .send({ text: 'Multi-tab test', clientMessageId: crypto.randomUUID() });

      mockIO.reset();

      const markRes = await request(app)
        .post(`/api/chat/conversations/${conversationId}/read`)
        .set('Authorization', `Bearer ${userB.firebaseUid}`)
        .send({ readSeq: 1 });

      expect(markRes.status).toBe(200);

      const inboxReadEvent = mockIO.emittedEvents.find(e => e.event === 'inbox:read');
      expect(inboxReadEvent).toBeDefined();
      expect(inboxReadEvent.rooms).toContain(`user:${userB._id}`);
      expect(inboxReadEvent.data).toEqual({
        conversationId: conversationId.toString(),
        readerId: userB._id.toString(),
        lastReadSeq: 1,
        lastSeq: 1,
        isUnread: false
      });
    });

    it('8. Moderation notice read emits inbox:read to reader official room', async () => {
      const modConv = await Conversation.create({
        participants: [adminUser._id, userB._id],
        isModeration: true,
        lastSeq: 1
      });

      mockIO.reset();

      const markRes = await request(app)
        .post(`/api/chat/conversations/${modConv._id}/read`)
        .set('Authorization', `Bearer ${userB.firebaseUid}`)
        .send({ readSeq: 1 });

      expect(markRes.status).toBe(200);
      expect(markRes.body.isUnread).toBe(false);

      const inboxReadEvent = mockIO.emittedEvents.find(e => e.event === 'inbox:read');
      expect(inboxReadEvent).toBeDefined();
      expect(inboxReadEvent.rooms).toContain(`official:${userB._id}`);
      expect(inboxReadEvent.data.isUnread).toBe(false);
    });
  });
});
