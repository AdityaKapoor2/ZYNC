import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import http from 'http';
import mongoose from 'mongoose';
import { io as ioClient } from 'socket.io-client';
import crypto from 'crypto';

import UserProfile from '../src/models/UserProfile.js';
import Conversation from '../src/models/Conversation.js';
import Message from '../src/models/Message.js';
import Connection from '../src/models/Connection.js';
import { connectTestDB, closeTestDB, clearTestDB } from './setup.js';
import { initSocket, _resetIO } from '../src/config/socket.js';

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

// Mock Firebase Admin for Socket.IO handshake auth
vi.mock('../src/config/firebase-admin.js', () => ({
  default: {
    auth: () => ({
      verifyIdToken: async (token) => {
        return { uid: token, email: `${token}@zync.test` };
      }
    })
  }
}));

import chatRoutes from '../src/routes/chatRoutes.js';

const app = express();
app.use(express.json());
app.use('/api/chat', chatRoutes);

describe('Checkpoint 2A: Transactional Ordinary Chat Persistence & Idempotency', () => {
  let userA, userB, userC, suspendedUser;
  let convAB;
  let server, ioServer, serverPort;
  const activeClients = new Set();

  beforeAll(async () => {
    await connectTestDB();

    server = http.createServer(app);
    ioServer = initSocket(server, { trustProxy: false });
    await new Promise((resolve) => server.listen(0, resolve));
    serverPort = server.address().port;
  });

  afterAll(async () => {
    for (const client of activeClients) {
      if (client.connected) client.disconnect();
    }
    activeClients.clear();

    if (ioServer) {
      await new Promise((resolve) => ioServer.close(resolve));
    }
    _resetIO();
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();

    userA = await UserProfile.create({
      firebaseUid: 'uid-user-a',
      email: 'usera@zync.test',
      displayName: 'User A',
      role: 'user',
      accountStatus: 'active'
    });

    userB = await UserProfile.create({
      firebaseUid: 'uid-user-b',
      email: 'userb@zync.test',
      displayName: 'User B',
      role: 'user',
      accountStatus: 'active'
    });

    userC = await UserProfile.create({
      firebaseUid: 'uid-user-c',
      email: 'userc@zync.test',
      displayName: 'User C',
      role: 'user',
      accountStatus: 'active'
    });

    suspendedUser = await UserProfile.create({
      firebaseUid: 'uid-suspended',
      email: 'suspended@zync.test',
      displayName: 'Suspended User',
      role: 'user',
      accountStatus: 'suspended'
    });

    // Create accepted friendship between User A and User B
    await Connection.create({
      requester: userA._id,
      recipient: userB._id,
      status: 'accepted'
    });

    // Ordinary conversation between User A and User B
    convAB = await Conversation.create({
      participants: [userA._id, userB._id],
      isModeration: false,
      lastSeq: 0
    });
  });

  function createSocketClient(token) {
    const client = ioClient(`http://localhost:${serverPort}`, {
      transports: ['websocket'],
      auth: { token },
      forceNew: true
    });
    activeClients.add(client);
    return client;
  }

  it('1. Normal successful send assigns seq 1 and increments conversation lastSeq', async () => {
    const clientMessageId = crypto.randomUUID();

    const res = await request(app)
      .post(`/api/chat/conversations/${convAB._id}/messages`)
      .set('Authorization', 'Bearer uid-user-a')
      .send({ text: 'Hello User B!', clientMessageId });

    expect(res.status).toBe(201);
    expect(res.body._id).toBeDefined();
    expect(res.body.seq).toBe(1);
    expect(res.body.clientMessageId).toBe(clientMessageId);
    expect(res.body.text).toBe('Hello User B!');
    expect(res.body.sender.toString()).toBe(userA._id.toString());

    // Verify conversation updated in DB
    const conv = await Conversation.findById(convAB._id);
    expect(conv.lastSeq).toBe(1);
    expect(conv.lastMessage.toString()).toBe(res.body._id.toString());

    // Verify message in DB
    const savedMsg = await Message.findById(res.body._id);
    expect(savedMsg.seq).toBe(1);
    expect(savedMsg.clientMessageId).toBe(clientMessageId);
  });

  it('2. Same-key, same-text retry returns HTTP 200 with original message and does not advance lastSeq', async () => {
    const clientMessageId = crypto.randomUUID();

    // First send
    const res1 = await request(app)
      .post(`/api/chat/conversations/${convAB._id}/messages`)
      .set('Authorization', 'Bearer uid-user-a')
      .send({ text: 'Unique idempotent message', clientMessageId });

    expect(res1.status).toBe(201);
    const originalId = res1.body._id;

    // Retry with identical key and text
    const res2 = await request(app)
      .post(`/api/chat/conversations/${convAB._id}/messages`)
      .set('Authorization', 'Bearer uid-user-a')
      .send({ text: 'Unique idempotent message', clientMessageId });

    expect(res2.status).toBe(200);
    expect(res2.body._id).toBe(originalId);
    expect(res2.body.seq).toBe(1);

    // Verify only 1 message exists in DB and lastSeq is still 1
    const count = await Message.countDocuments({ conversationId: convAB._id });
    expect(count).toBe(1);

    const conv = await Conversation.findById(convAB._id);
    expect(conv.lastSeq).toBe(1);
  });

  it('3. Same-key, different-text retry returns HTTP 409 Conflict', async () => {
    const clientMessageId = crypto.randomUUID();

    const res1 = await request(app)
      .post(`/api/chat/conversations/${convAB._id}/messages`)
      .set('Authorization', 'Bearer uid-user-a')
      .send({ text: 'Original message text', clientMessageId });

    expect(res1.status).toBe(201);

    // Reuse key with modified text
    const res2 = await request(app)
      .post(`/api/chat/conversations/${convAB._id}/messages`)
      .set('Authorization', 'Bearer uid-user-a')
      .send({ text: 'Tampered message text', clientMessageId });

    expect(res2.status).toBe(409);
    expect(res2.body.message).toMatch(/cannot be reused with different message content/);

    // Message in DB remains unchanged
    const msg = await Message.findById(res1.body._id);
    expect(msg.text).toBe('Original message text');
  });

  it('4. Concurrent duplicate sends produce exactly one persisted message and one sequence allocation', async () => {
    const clientMessageId = crypto.randomUUID();

    const [resA, resB] = await Promise.all([
      request(app)
        .post(`/api/chat/conversations/${convAB._id}/messages`)
        .set('Authorization', 'Bearer uid-user-a')
        .send({ text: 'Concurrent send test', clientMessageId }),
      request(app)
        .post(`/api/chat/conversations/${convAB._id}/messages`)
        .set('Authorization', 'Bearer uid-user-a')
        .send({ text: 'Concurrent send test', clientMessageId })
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 201]);

    const count = await Message.countDocuments({ conversationId: convAB._id });
    expect(count).toBe(1);

    const conv = await Conversation.findById(convAB._id);
    expect(conv.lastSeq).toBe(1);
  });

  it('5. Concurrent distinct sends receive distinct contiguous sequences', async () => {
    const payloads = [1, 2, 3, 4, 5].map((n) => ({
      text: `Message ${n}`,
      clientMessageId: crypto.randomUUID()
    }));

    const responses = await Promise.all(
      payloads.map((p) =>
        request(app)
          .post(`/api/chat/conversations/${convAB._id}/messages`)
          .set('Authorization', 'Bearer uid-user-a')
          .send(p)
      )
    );

    for (const res of responses) {
      expect(res.status).toBe(201);
    }

    const messages = await Message.find({ conversationId: convAB._id }).sort({ seq: 1 });
    expect(messages).toHaveLength(5);

    const seqs = messages.map((m) => m.seq);
    expect(seqs).toEqual([1, 2, 3, 4, 5]);

    const conv = await Conversation.findById(convAB._id);
    expect(conv.lastSeq).toBe(5);
  });

  it('6. Transaction failure leaves no partial message or incorrect conversation metadata', async () => {
    const clientMessageId = crypto.randomUUID();

    // Spy on Message.prototype.save and simulate a fatal DB failure during transaction
    const saveSpy = vi.spyOn(Message.prototype, 'save').mockImplementationOnce(async () => {
      throw new Error('SIMULATED_TRANSACTION_FAILURE');
    });

    const res = await request(app)
      .post(`/api/chat/conversations/${convAB._id}/messages`)
      .set('Authorization', 'Bearer uid-user-a')
      .send({ text: 'This will fail in transaction', clientMessageId });

    expect(res.status).toBe(500);

    saveSpy.mockRestore();

    // Verify rollback: no message in DB, lastSeq remains 0
    const count = await Message.countDocuments({ conversationId: convAB._id });
    expect(count).toBe(0);

    const conv = await Conversation.findById(convAB._id);
    expect(conv.lastSeq).toBe(0);
    expect(conv.lastMessage).toBeUndefined();
  });

  it('7. Socket emission occurs after commit only, and no duplicate event is emitted for an idempotent retry', async () => {
    const clientMessageId = crypto.randomUUID();
    const receivedEvents = [];

    // Connect User B socket client to receive events
    const socketB = createSocketClient('uid-user-b');
    await new Promise((resolve) => socketB.on('connect', resolve));

    socketB.on('chat:message', (data) => {
      receivedEvents.push(data);
    });

    // Small delay to ensure socket room joins are complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Send original message
    const res1 = await request(app)
      .post(`/api/chat/conversations/${convAB._id}/messages`)
      .set('Authorization', 'Bearer uid-user-a')
      .send({ text: 'Live socket event message', clientMessageId });

    expect(res1.status).toBe(201);

    // Wait for event to arrive
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0].text).toBe('Live socket event message');
    expect(receivedEvents[0].seq).toBe(1);
    expect(receivedEvents[0].clientMessageId).toBe(clientMessageId);

    // Idempotent retry
    const res2 = await request(app)
      .post(`/api/chat/conversations/${convAB._id}/messages`)
      .set('Authorization', 'Bearer uid-user-a')
      .send({ text: 'Live socket event message', clientMessageId });

    expect(res2.status).toBe(200);

    // Wait and assert no additional event was emitted
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(receivedEvents).toHaveLength(1);

    socketB.disconnect();
  });

  it('8. Unauthorized or suspended callers cannot use an existing idempotency key to bypass restrictions', async () => {
    const clientMessageId = crypto.randomUUID();

    // 1. User A creates message
    const res1 = await request(app)
      .post(`/api/chat/conversations/${convAB._id}/messages`)
      .set('Authorization', 'Bearer uid-user-a')
      .send({ text: 'Legitimate message', clientMessageId });
    expect(res1.status).toBe(201);

    // 2. Suspended user attempts to send using same key
    const resSuspended = await request(app)
      .post(`/api/chat/conversations/${convAB._id}/messages`)
      .set('Authorization', 'Bearer uid-suspended')
      .send({ text: 'Legitimate message', clientMessageId });
    expect(resSuspended.status).toBe(403);
    expect(resSuspended.body.message).toMatch(/Not authorized|suspended/);

    // 3. User C (unconnected third party) attempts to send using same key
    const resUserC = await request(app)
      .post(`/api/chat/conversations/${convAB._id}/messages`)
      .set('Authorization', 'Bearer uid-user-c')
      .send({ text: 'Legitimate message', clientMessageId });
    expect(resUserC.status).toBe(403);
    expect(resUserC.body.message).toMatch(/Not authorized/);

    // 4. User B (valid participant) attempts to reuse User A's key
    const resUserB = await request(app)
      .post(`/api/chat/conversations/${convAB._id}/messages`)
      .set('Authorization', 'Bearer uid-user-b')
      .send({ text: 'Legitimate message', clientMessageId });
    expect(resUserB.status).toBe(409);
    expect(resUserB.body.message).toMatch(/used by another sender/);
  });

  it('9. Invalid or missing UUID v4 clientMessageId is rejected with HTTP 400', async () => {
    // Missing clientMessageId
    const resMissing = await request(app)
      .post(`/api/chat/conversations/${convAB._id}/messages`)
      .set('Authorization', 'Bearer uid-user-a')
      .send({ text: 'Hello' });
    expect(resMissing.status).toBe(400);
    expect(resMissing.body.message).toMatch(/Valid UUID v4 clientMessageId is required/);

    // Arbitrary non-UUID string
    const resInvalid = await request(app)
      .post(`/api/chat/conversations/${convAB._id}/messages`)
      .set('Authorization', 'Bearer uid-user-a')
      .send({ text: 'Hello', clientMessageId: 'not-a-valid-uuid' });
    expect(resInvalid.status).toBe(400);
    expect(resInvalid.body.message).toMatch(/Valid UUID v4 clientMessageId is required/);

    // Empty string
    const resEmpty = await request(app)
      .post(`/api/chat/conversations/${convAB._id}/messages`)
      .set('Authorization', 'Bearer uid-user-a')
      .send({ text: 'Hello', clientMessageId: '   ' });
    expect(resEmpty.status).toBe(400);
    expect(resEmpty.body.message).toMatch(/Valid UUID v4 clientMessageId is required/);
  });

  it('10. Socket emission error during chat:message does not prevent HTTP 201, preserves sequence, and allows inbox:activity to proceed', async () => {
    const clientMessageId = crypto.randomUUID();
    let chatMessageAttempted = false;
    let inboxActivityDelivered = false;

    // Connect User B socket client to receive inbox:activity
    const socketB = createSocketClient('uid-user-b');
    await new Promise((resolve) => socketB.on('connect', resolve));
    socketB.on('inbox:activity', () => {
      inboxActivityDelivered = true;
    });

    // Small delay to ensure socket room joins are complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Spy on ioServer.to
    const originalTo = ioServer.to.bind(ioServer);
    const toSpy = vi.spyOn(ioServer, 'to').mockImplementation((room) => {
      const op = originalTo(room);
      return {
        to: (secondRoom) => {
          return {
            emit: (eventName, ...args) => {
              if (eventName === 'chat:message') {
                chatMessageAttempted = true;
                throw new Error('SIMULATED_CHAT_MESSAGE_EMIT_FAILURE');
              }
              return op.to(secondRoom).emit(eventName, ...args);
            }
          };
        },
        emit: (eventName, ...args) => {
          return op.emit(eventName, ...args);
        }
      };
    });

    const res = await request(app)
      .post(`/api/chat/conversations/${convAB._id}/messages`)
      .set('Authorization', 'Bearer uid-user-a')
      .send({ text: 'Message with socket error', clientMessageId });

    toSpy.mockRestore();

    // 1. Returns HTTP 201 with committed message
    expect(res.status).toBe(201);
    expect(res.body.seq).toBe(1);
    expect(res.body.text).toBe('Message with socket error');
    expect(chatMessageAttempted).toBe(true);

    // 2. Wait for inbox:activity to arrive at socketB
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(inboxActivityDelivered).toBe(true);

    // 3. Persisted message and conversation sequence are authoritative
    const savedMsg = await Message.findById(res.body._id);
    expect(savedMsg).toBeDefined();
    expect(savedMsg.seq).toBe(1);

    const conv = await Conversation.findById(convAB._id);
    expect(conv.lastSeq).toBe(1);
    expect(conv.lastMessage.toString()).toBe(res.body._id.toString());

    // 4. Retry with same key returns HTTP 200 without creating a duplicate or incrementing sequence
    const retryRes = await request(app)
      .post(`/api/chat/conversations/${convAB._id}/messages`)
      .set('Authorization', 'Bearer uid-user-a')
      .send({ text: 'Message with socket error', clientMessageId });

    expect(retryRes.status).toBe(200);
    expect(retryRes.body._id).toBe(res.body._id);
    expect(retryRes.body.seq).toBe(1);

    const count = await Message.countDocuments({ conversationId: convAB._id });
    expect(count).toBe(1);
    const convAfterRetry = await Conversation.findById(convAB._id);
    expect(convAfterRetry.lastSeq).toBe(1);

    socketB.disconnect();
  });

  it('11. Total socket failure (both emissions throw) still returns HTTP 201, persists message, and retains idempotency', async () => {
    const clientMessageId = crypto.randomUUID();

    const toSpy = vi.spyOn(ioServer, 'to').mockImplementation(() => {
      throw new Error('SIMULATED_TOTAL_SOCKET_FAILURE');
    });

    const res = await request(app)
      .post(`/api/chat/conversations/${convAB._id}/messages`)
      .set('Authorization', 'Bearer uid-user-a')
      .send({ text: 'Message under total socket failure', clientMessageId });

    toSpy.mockRestore();

    expect(res.status).toBe(201);
    expect(res.body.seq).toBe(1);
    expect(res.body.text).toBe('Message under total socket failure');

    const savedMsg = await Message.findById(res.body._id);
    expect(savedMsg.seq).toBe(1);

    const conv = await Conversation.findById(convAB._id);
    expect(conv.lastSeq).toBe(1);

    // Idempotent retry succeeds
    const retryRes = await request(app)
      .post(`/api/chat/conversations/${convAB._id}/messages`)
      .set('Authorization', 'Bearer uid-user-a')
      .send({ text: 'Message under total socket failure', clientMessageId });

    expect(retryRes.status).toBe(200);
    expect(retryRes.body._id).toBe(res.body._id);
    expect(retryRes.body.seq).toBe(1);

    const count = await Message.countDocuments({ conversationId: convAB._id });
    expect(count).toBe(1);
  });

  it('12. Genuine transaction/database failure returns HTTP 500 and does NOT emit socket events', async () => {
    const clientMessageId = crypto.randomUUID();
    let socketEmissionOccurred = false;

    const toSpy = vi.spyOn(ioServer, 'to').mockImplementation(() => {
      socketEmissionOccurred = true;
      throw new Error('SHOULD_NOT_BE_CALLED');
    });

    const saveSpy = vi.spyOn(Message.prototype, 'save').mockImplementationOnce(async () => {
      throw new Error('FATAL_DATABASE_ERROR');
    });

    const res = await request(app)
      .post(`/api/chat/conversations/${convAB._id}/messages`)
      .set('Authorization', 'Bearer uid-user-a')
      .send({ text: 'Will fail at database level', clientMessageId });

    toSpy.mockRestore();
    saveSpy.mockRestore();

    expect(res.status).toBe(500);
    expect(socketEmissionOccurred).toBe(false);

    const count = await Message.countDocuments({ conversationId: convAB._id });
    expect(count).toBe(0);

    const conv = await Conversation.findById(convAB._id);
    expect(conv.lastSeq).toBe(0);
  });
});
