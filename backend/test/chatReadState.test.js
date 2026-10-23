import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import crypto from 'crypto';

import UserProfile from '../src/models/UserProfile.js';
import Conversation from '../src/models/Conversation.js';
import Message from '../src/models/Message.js';
import Connection from '../src/models/Connection.js';
import { connectTestDB, closeTestDB, clearTestDB } from './setup.js';

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

const app = express();
app.use(express.json());
app.use('/api/chat', chatRoutes);

describe('Phase 2B: Monotonic Read State, Emission Guarding & PATCH Compatibility', () => {
  let userA, userB, userC, suspendedUser, superAdmin;
  let convAB;

  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    mockIO.reset();
    await clearTestDB();

    userA = await UserProfile.create({
      firebaseUid: 'uid-alice',
      email: 'alice@zync.test',
      displayName: 'Alice',
      role: 'user',
      accountStatus: 'active'
    });

    userB = await UserProfile.create({
      firebaseUid: 'uid-bob',
      email: 'bob@zync.test',
      displayName: 'Bob',
      role: 'user',
      accountStatus: 'active'
    });

    userC = await UserProfile.create({
      firebaseUid: 'uid-charlie',
      email: 'charlie@zync.test',
      displayName: 'Charlie',
      role: 'user',
      accountStatus: 'active'
    });

    suspendedUser = await UserProfile.create({
      firebaseUid: 'uid-suspended',
      email: 'suspended@zync.test',
      displayName: 'SuspendedUser',
      role: 'user',
      accountStatus: 'suspended'
    });

    superAdmin = await UserProfile.create({
      firebaseUid: 'uid-superadmin',
      email: 'admin@zync.test',
      displayName: 'SuperAdmin',
      role: 'super_admin',
      accountStatus: 'active'
    });

    await Connection.create({
      requester: userA._id,
      recipient: userB._id,
      status: 'accepted'
    });

    // Seed conversation with 5 messages (lastSeq = 5)
    convAB = await Conversation.create({
      participants: [userA._id, userB._id],
      isModeration: false,
      lastSeq: 5,
      readState: [
        { user: userA._id, lastReadSeq: 5 },
        { user: userB._id, lastReadSeq: 2 }
      ]
    });
  });

  it('1. Forward advancement: advances lastReadSeq and emits both chat:read and inbox:read', async () => {
    const res = await request(app)
      .post(`/api/chat/conversations/${convAB._id}/read`)
      .set('Authorization', 'Bearer uid-bob')
      .send({ readSeq: 4 });

    expect(res.status).toBe(200);
    expect(res.body.conversationId.toString()).toBe(convAB._id.toString());
    expect(res.body.lastReadSeq).toBe(4);
    expect(res.body.lastSeq).toBe(5);
    expect(res.body.isUnread).toBe(true);

    // Verify DB updated
    const updated = await Conversation.findById(convAB._id);
    const bobEntry = updated.readState.find(r => r.user.toString() === userB._id.toString());
    expect(bobEntry.lastReadSeq).toBe(4);

    // Verify socket emissions
    const chatRead = mockIO.emittedEvents.find(e => e.event === 'chat:read');
    expect(chatRead).toBeDefined();
    expect(chatRead.rooms).toContain(`user:${userA._id}`);
    expect(chatRead.data).toEqual({
      conversationId: convAB._id.toString(),
      readerId: userB._id.toString(),
      lastReadSeq: 4
    });

    const inboxRead = mockIO.emittedEvents.find(e => e.event === 'inbox:read');
    expect(inboxRead).toBeDefined();
    expect(inboxRead.rooms).toContain(`user:${userB._id}`);
    expect(inboxRead.data).toEqual({
      conversationId: convAB._id.toString(),
      readerId: userB._id.toString(),
      lastReadSeq: 4,
      lastSeq: 5,
      isUnread: true
    });
  });

  it('2. Duplicate read: repeating the current cursor returns HTTP 200 and emits ZERO events', async () => {
    // Bob is already at lastReadSeq: 2
    mockIO.reset();

    const res = await request(app)
      .post(`/api/chat/conversations/${convAB._id}/read`)
      .set('Authorization', 'Bearer uid-bob')
      .send({ readSeq: 2 });

    expect(res.status).toBe(200);
    expect(res.body.lastReadSeq).toBe(2);
    expect(res.body.isUnread).toBe(true);

    // Emission guard: ZERO socket events emitted!
    expect(mockIO.emittedEvents.filter(e => e.event === 'chat:read')).toHaveLength(0);
    expect(mockIO.emittedEvents.filter(e => e.event === 'inbox:read')).toHaveLength(0);

    const updated = await Conversation.findById(convAB._id);
    const bobEntry = updated.readState.find(r => r.user.toString() === userB._id.toString());
    expect(bobEntry.lastReadSeq).toBe(2);
  });

  it('3. Older read: a request below current cursor never moves cursor backward and emits ZERO events', async () => {
    // Bob is at 2, requests readSeq: 1
    mockIO.reset();

    const res = await request(app)
      .post(`/api/chat/conversations/${convAB._id}/read`)
      .set('Authorization', 'Bearer uid-bob')
      .send({ readSeq: 1 });

    expect(res.status).toBe(200);
    expect(res.body.lastReadSeq).toBe(2); // Stays at 2!
    expect(res.body.isUnread).toBe(true);

    // Emission guard: ZERO events emitted
    expect(mockIO.emittedEvents.filter(e => e.event === 'chat:read')).toHaveLength(0);
    expect(mockIO.emittedEvents.filter(e => e.event === 'inbox:read')).toHaveLength(0);

    const updated = await Conversation.findById(convAB._id);
    const bobEntry = updated.readState.find(r => r.user.toString() === userB._id.toString());
    expect(bobEntry.lastReadSeq).toBe(2);
  });

  it('4. Concurrent reads: concurrent identical requests advance cursor and emit exactly once', async () => {
    mockIO.reset();

    // Send two concurrent requests to mark up to seq 5
    const [res1, res2] = await Promise.all([
      request(app)
        .post(`/api/chat/conversations/${convAB._id}/read`)
        .set('Authorization', 'Bearer uid-bob')
        .send({ readSeq: 5 }),
      request(app)
        .post(`/api/chat/conversations/${convAB._id}/read`)
        .set('Authorization', 'Bearer uid-bob')
        .send({ readSeq: 5 })
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res1.body.lastReadSeq).toBe(5);
    expect(res2.body.lastReadSeq).toBe(5);
    expect(res1.body.isUnread).toBe(false);
    expect(res2.body.isUnread).toBe(false);

    // Exactly one set of emissions because only one request actually advanced the document
    const chatReadEvents = mockIO.emittedEvents.filter(e => e.event === 'chat:read');
    const inboxReadEvents = mockIO.emittedEvents.filter(e => e.event === 'inbox:read');
    expect(chatReadEvents).toHaveLength(1);
    expect(inboxReadEvents).toHaveLength(1);

    const updated = await Conversation.findById(convAB._id);
    const bobEntry = updated.readState.find(r => r.user.toString() === userB._id.toString());
    expect(bobEntry.lastReadSeq).toBe(5);
  });

  it('5. PATCH compatibility: PATCH route performs same operation and returns identical response shape', async () => {
    const res = await request(app)
      .patch(`/api/chat/conversations/${convAB._id}/read`)
      .set('Authorization', 'Bearer uid-bob')
      .send({ readSeq: 3 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      conversationId: convAB._id.toString(),
      lastReadSeq: 3,
      lastSeq: 5,
      isUnread: true
    });

    const updated = await Conversation.findById(convAB._id);
    const bobEntry = updated.readState.find(r => r.user.toString() === userB._id.toString());
    expect(bobEntry.lastReadSeq).toBe(3);

    expect(mockIO.emittedEvents.filter(e => e.event === 'chat:read')).toHaveLength(1);
    expect(mockIO.emittedEvents.filter(e => e.event === 'inbox:read')).toHaveLength(1);
  });

  it('6. POST compatibility: existing POST route remains fully functional and backward compatible', async () => {
    const res = await request(app)
      .post(`/api/chat/conversations/${convAB._id}/read`)
      .set('Authorization', 'Bearer uid-bob')
      .send({ readSeq: 5 });

    expect(res.status).toBe(200);
    expect(res.body.lastReadSeq).toBe(5);
    expect(res.body.isUnread).toBe(false);
  });

  it('7. Authorization: nonparticipants cannot mark conversation as read or trigger socket events', async () => {
    const res = await request(app)
      .patch(`/api/chat/conversations/${convAB._id}/read`)
      .set('Authorization', 'Bearer uid-charlie')
      .send({ readSeq: 5 });

    expect(res.status).toBe(404); // Non-disclosure of conversation existence
    expect(mockIO.emittedEvents).toHaveLength(0);
  });

  it('8. Reader identity: readerId in socket events is derived strictly from verified auth, ignoring client tampering', async () => {
    const res = await request(app)
      .patch(`/api/chat/conversations/${convAB._id}/read`)
      .set('Authorization', 'Bearer uid-bob')
      .send({ readSeq: 4, readerId: userC._id.toString(), reader: 'spoofed' });

    expect(res.status).toBe(200);

    const chatRead = mockIO.emittedEvents.find(e => e.event === 'chat:read');
    expect(chatRead.data.readerId).toBe(userB._id.toString());
    expect(chatRead.data.readerId).not.toBe(userC._id.toString());
  });

  it('9. Moderation conversation: correct official:<id> routing is retained for moderation notices', async () => {
    const modConv = await Conversation.create({
      participants: [superAdmin._id, suspendedUser._id],
      isModeration: true,
      lastSeq: 3,
      readState: [
        { user: superAdmin._id, lastReadSeq: 3 },
        { user: suspendedUser._id, lastReadSeq: 1 }
      ]
    });

    const res = await request(app)
      .patch(`/api/chat/conversations/${modConv._id}/read`)
      .set('Authorization', 'Bearer uid-suspended')
      .send({ readSeq: 3 });

    expect(res.status).toBe(200);
    expect(res.body.lastReadSeq).toBe(3);
    expect(res.body.isUnread).toBe(false);

    // Verify routed to official rooms
    const chatRead = mockIO.emittedEvents.find(e => e.event === 'chat:read');
    expect(chatRead.rooms).toContain(`official:${superAdmin._id}`);

    const inboxRead = mockIO.emittedEvents.find(e => e.event === 'inbox:read');
    expect(inboxRead.rooms).toContain(`official:${suspendedUser._id}`);
  });

  it('10. Socket failure: socket emission error does NOT turn successful update into HTTP 500', async () => {
    const originalEmit = mockIO.emit.bind(mockIO);
    vi.spyOn(mockIO, 'emit').mockImplementationOnce(() => {
      throw new Error('SIMULATED_SOCKET_CRASH');
    });

    const res = await request(app)
      .patch(`/api/chat/conversations/${convAB._id}/read`)
      .set('Authorization', 'Bearer uid-bob')
      .send({ readSeq: 4 });

    mockIO.emit = originalEmit;

    expect(res.status).toBe(200);
    expect(res.body.lastReadSeq).toBe(4);

    const updated = await Conversation.findById(convAB._id);
    const bobEntry = updated.readState.find(r => r.user.toString() === userB._id.toString());
    expect(bobEntry.lastReadSeq).toBe(4);
  });

  it('11. Input validation: invalid sequence values return HTTP 400', async () => {
    // Negative integer
    const negRes = await request(app)
      .patch(`/api/chat/conversations/${convAB._id}/read`)
      .set('Authorization', 'Bearer uid-bob')
      .send({ readSeq: -1 });
    expect(negRes.status).toBe(400);

    // Non-integer string
    const stringRes = await request(app)
      .patch(`/api/chat/conversations/${convAB._id}/read`)
      .set('Authorization', 'Bearer uid-bob')
      .send({ readSeq: 'invalid' });
    expect(stringRes.status).toBe(400);

    // Exceeds lastSeq
    const exceedRes = await request(app)
      .patch(`/api/chat/conversations/${convAB._id}/read`)
      .set('Authorization', 'Bearer uid-bob')
      .send({ readSeq: 999 });
    expect(exceedRes.status).toBe(400);
    expect(exceedRes.body.message).toContain('cannot exceed');
  });

  it('12. Default read: omitting readSeq defaults targetSeq to conversation.lastSeq and marks completely read', async () => {
    // Bob at 2, lastSeq is 5
    const res = await request(app)
      .patch(`/api/chat/conversations/${convAB._id}/read`)
      .set('Authorization', 'Bearer uid-bob')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.lastReadSeq).toBe(5);
    expect(res.body.isUnread).toBe(false);

    const updated = await Conversation.findById(convAB._id);
    const bobEntry = updated.readState.find(r => r.user.toString() === userB._id.toString());
    expect(bobEntry.lastReadSeq).toBe(5);
  });
});
