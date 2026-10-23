import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import crypto from 'crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

import UserProfile from '../src/models/UserProfile.js';
import Report from '../src/models/Report.js';
import Conversation from '../src/models/Conversation.js';
import Message from '../src/models/Message.js';
import Connection from '../src/models/Connection.js';

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

import adminRoutes from '../src/routes/adminRoutes.js';
import chatRoutes from '../src/routes/chatRoutes.js';

const app = express();
app.use(express.json());
app.use('/api/admin', adminRoutes);
app.use('/api/chat', chatRoutes);

describe('Recipient-Side Visibility of Super Admin Messages', () => {
  let replSet;
  let adminProfile, reporterUser, reportedUser, unrelatedUser;
  let report;

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
    await Connection.deleteMany({});

    adminProfile = await UserProfile.create({
      firebaseUid: 'super_admin_uid',
      email: 'admin@zync.gg',
      displayName: 'AdminAlice',
      role: 'super_admin',
      accountStatus: 'active',
      games: []
    });

    reporterUser = await UserProfile.create({
      firebaseUid: 'reporter_uid',
      email: 'reporter@zync.gg',
      displayName: 'ReporterBob',
      role: 'user',
      accountStatus: 'active',
      games: []
    });

    reportedUser = await UserProfile.create({
      firebaseUid: 'reported_uid',
      email: 'reported@zync.gg',
      displayName: 'ReportedCharlie',
      role: 'user',
      accountStatus: 'active',
      games: []
    });

    unrelatedUser = await UserProfile.create({
      firebaseUid: 'unrelated_uid',
      email: 'unrelated@zync.gg',
      displayName: 'UnrelatedDave',
      role: 'user',
      accountStatus: 'active',
      games: []
    });

    report = await Report.create({
      reporter: reporterUser._id,
      reportedUser: reportedUser._id,
      reason: 'Harassment',
      status: 'pending'
    });
  });

  it('1 & 2. Super Admin sends a message through the authorized report-messaging endpoint, persisting under correct Conversation', async () => {
    const res = await request(app)
      .post(`/api/admin/reports/${report._id}/message`)
      .set('Authorization', 'Bearer super_admin_uid')
      .send({ recipientType: 'reportedUser', message: 'Official inquiry regarding match conduct.' });

    expect(res.status).toBe(201);
    expect(res.body.conversationId).toBeDefined();

    // Verify persisted database state for conversation
    const conversation = await Conversation.findById(res.body.conversationId);
    expect(conversation).not.toBeNull();
    expect(conversation.isModeration).toBe(true);
    expect(conversation.participants).toHaveLength(2);
    expect(conversation.participants.map(p => p.toString())).toContain(adminProfile._id.toString());
    expect(conversation.participants.map(p => p.toString())).toContain(reportedUser._id.toString());
    expect(conversation.lastMessage).toBeDefined();
    expect(conversation.lastMessageAt).toBeDefined();

    // Verify persisted database state for message
    const message = await Message.findById(conversation.lastMessage);
    expect(message).not.toBeNull();
    expect(message.conversationId.toString()).toBe(conversation._id.toString());
    expect(message.sender.toString()).toBe(adminProfile._id.toString());
    expect(message.senderRole).toBe('admin');
    expect(message.senderDisplayName).toBe('ZYNC Super Admin');
    expect(message.text).toBe('Official inquiry regarding match conduct.');
  });

  it('3 & 4. Intended recipient is a participant and can retrieve Conversation and messages via APIs', async () => {
    // Admin sends message to reporter
    const adminRes = await request(app)
      .post(`/api/admin/reports/${report._id}/message`)
      .set('Authorization', 'Bearer super_admin_uid')
      .send({ recipientType: 'reporter', message: 'Thank you for your report. We are reviewing evidence.' });

    const convId = adminRes.body.conversationId;

    // Recipient fetches conversation list
    const convListRes = await request(app)
      .get('/api/chat/conversations')
      .set('Authorization', 'Bearer reporter_uid');

    expect(convListRes.status).toBe(200);
    expect(convListRes.body).toHaveLength(1);
    expect(convListRes.body[0]._id.toString()).toBe(convId.toString());
    expect(convListRes.body[0].isModeration).toBe(true);
    expect(convListRes.body[0].lastMessage).toBeDefined();
    expect(convListRes.body[0].lastMessage.text).toBe('Thank you for your report. We are reviewing evidence.');
    expect(convListRes.body[0].lastMessage.senderRole).toBe('admin');
    expect(convListRes.body[0].lastMessage.senderDisplayName).toBe('ZYNC Super Admin');

    // Recipient attempts to open direct conversation via targetUserId (Super Admin ID) -> 403 Forbidden
    const getOrCreateres = await request(app)
      .post(`/api/chat/conversations/${adminProfile._id}`)
      .set('Authorization', 'Bearer reporter_uid');

    expect(getOrCreateres.status).toBe(403);
    expect(getOrCreateres.body.message).toBe('Direct chat with Super Admin is not permitted');

    // Recipient attempts to send direct chat message to Super Admin in report conversation -> 403 Forbidden
    const sendRes = await request(app)
      .post(`/api/chat/conversations/${convId}/messages`)
      .set('Authorization', 'Bearer reporter_uid')
      .send({ text: 'Unauthorized chat attempt to admin' });

    expect(sendRes.status).toBe(403);
    expect(sendRes.body.message).toBe('Direct chat with Super Admin is not permitted');

    // Recipient retrieves official notice message history
    const msgsRes = await request(app)
      .get(`/api/chat/conversations/${convId}/messages`)
      .set('Authorization', 'Bearer reporter_uid');

    expect(msgsRes.status).toBe(200);
    const msgs = msgsRes.body.messages || msgsRes.body;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].text).toBe('Thank you for your report. We are reviewing evidence.');
    expect(msgs[0].senderRole).toBe('admin');
    expect(msgs[0].senderDisplayName).toBe('ZYNC Super Admin');
  });

  it('5. The recipient receives a discoverable Inbox item linking to the correct Conversation', async () => {
    await request(app)
      .post(`/api/admin/reports/${report._id}/message`)
      .set('Authorization', 'Bearer super_admin_uid')
      .send({ recipientType: 'reportedUser', message: 'Action required on your account.' });

    // Calling /api/chat/inbox (or /api/chat/conversations)
    const inboxRes = await request(app)
      .get('/api/chat/inbox')
      .set('Authorization', 'Bearer reported_uid');

    expect(inboxRes.status).toBe(200);
    expect(inboxRes.body).toHaveLength(1);

    const inboxItem = inboxRes.body[0];
    expect(inboxItem._id).toBeDefined();
    expect(inboxItem.isModeration).toBe(true);
    expect(inboxItem.lastMessage).toBeDefined();
    expect(inboxItem.lastMessage.text).toBe('Action required on your account.');
    expect(inboxItem.lastMessage.senderRole).toBe('admin');
    expect(inboxItem.lastMessage.senderDisplayName).toBe('ZYNC Super Admin');

    // Participants include the other party (AdminAlice)
    const otherParticipant = inboxItem.participants.find(p => p._id.toString() === adminProfile._id.toString());
    expect(otherParticipant).toBeDefined();
    expect(otherParticipant.role).toBe('super_admin');
  });

  it('6 & 7. The recipient can retrieve the message after refreshing/re-authenticating with persistent administrative identity', async () => {
    const adminRes = await request(app)
      .post(`/api/admin/reports/${report._id}/message`)
      .set('Authorization', 'Bearer super_admin_uid')
      .send({ recipientType: 'reportedUser', message: 'Persistent moderation warning.' });

    const convId = adminRes.body.conversationId;

    // Simulate subsequent fresh authentication / session
    const freshToken = 'reported_uid';
    const refetchInbox = await request(app)
      .get('/api/chat/conversations')
      .set('Authorization', `Bearer ${freshToken}`);

    expect(refetchInbox.status).toBe(200);
    expect(refetchInbox.body[0]._id.toString()).toBe(convId.toString());

    const refetchMessages = await request(app)
      .get(`/api/chat/conversations/${convId}/messages`)
      .set('Authorization', `Bearer ${freshToken}`);

    expect(refetchMessages.status).toBe(200);
    const msg = (refetchMessages.body.messages || refetchMessages.body)[0];
    expect(msg.senderRole).toBe('admin');
    expect(msg.senderDisplayName).toBe('ZYNC Super Admin');
    expect(msg.text).toBe('Persistent moderation warning.');
  });

  it('8. An unrelated user cannot retrieve the Conversation, message, or Inbox item', async () => {
    const adminRes = await request(app)
      .post(`/api/admin/reports/${report._id}/message`)
      .set('Authorization', 'Bearer super_admin_uid')
      .send({ recipientType: 'reportedUser', message: 'Private moderation inquiry.' });

    const convId = adminRes.body.conversationId;

    // Unrelated user checks their inbox / conversation list
    const unrelatedInbox = await request(app)
      .get('/api/chat/conversations')
      .set('Authorization', 'Bearer unrelated_uid');

    expect(unrelatedInbox.status).toBe(200);
    expect(unrelatedInbox.body).toHaveLength(0);

    // Unrelated user attempts to directly fetch the conversation messages -> 403 Forbidden
    const unauthFetch = await request(app)
      .get(`/api/chat/conversations/${convId}/messages`)
      .set('Authorization', 'Bearer unrelated_uid');

    expect(unauthFetch.status).toBe(403);
    expect(unauthFetch.body.message).toContain('Not authorized to view this conversation');
  });

  it('9. Repeated requests do not create duplicate discovery items', async () => {
    // Send message 1
    const res1 = await request(app)
      .post(`/api/admin/reports/${report._id}/message`)
      .set('Authorization', 'Bearer super_admin_uid')
      .send({ recipientType: 'reportedUser', message: 'Initial notice.' });

    // Send message 2 (same report/user)
    const res2 = await request(app)
      .post(`/api/admin/reports/${report._id}/message`)
      .set('Authorization', 'Bearer super_admin_uid')
      .send({ recipientType: 'reportedUser', message: 'Follow-up notice.' });

    expect(res1.body.conversationId).toBe(res2.body.conversationId);

    // Database has exactly 1 Conversation between them
    const convCount = await Conversation.countDocuments({
      participants: { $all: [adminProfile._id, reportedUser._id] }
    });
    expect(convCount).toBe(1);

    // Recipient inbox returns exactly 1 conversation with updated lastMessage preview
    const inbox = await request(app)
      .get('/api/chat/conversations')
      .set('Authorization', 'Bearer reported_uid');

    expect(inbox.body).toHaveLength(1);
    expect(inbox.body[0].lastMessage.text).toBe('Follow-up notice.');
  });

  it('10. Suspended recipients can retrieve and reply to moderation messages', async () => {
    // Suspend reportedUser
    await UserProfile.findByIdAndUpdate(reportedUser._id, { accountStatus: 'suspended' });

    // Admin sends message to suspended user regarding report
    const adminRes = await request(app)
      .post(`/api/admin/reports/${report._id}/message`)
      .set('Authorization', 'Bearer super_admin_uid')
      .send({ recipientType: 'reportedUser', message: 'Your account has been suspended. Please reply if you have questions.' });

    const convId = adminRes.body.conversationId;

    // Suspended user can discover the conversation in /conversations
    const suspendedInbox = await request(app)
      .get('/api/chat/conversations')
      .set('Authorization', 'Bearer reported_uid');

    expect(suspendedInbox.status).toBe(200);
    expect(suspendedInbox.body).toHaveLength(1);
    expect(suspendedInbox.body[0].isModeration).toBe(true);

    // Suspended user can fetch messages
    const msgsRes = await request(app)
      .get(`/api/chat/conversations/${convId}/messages`)
      .set('Authorization', 'Bearer reported_uid');

    expect(msgsRes.status).toBe(200);
    expect(msgsRes.body.messages || msgsRes.body).toHaveLength(1);

    // Suspended user can reply as user
    const replyRes = await request(app)
      .post(`/api/chat/conversations/${convId}/messages`)
      .set('Authorization', 'Bearer reported_uid')
      .send({ text: 'I understand, submitting additional evidence now.', clientMessageId: crypto.randomUUID() });

    expect(replyRes.status).toBe(201);
    expect(replyRes.body.senderRole).toBe('user');
    expect(replyRes.body.senderDisplayName).toBe('ReportedCharlie');

    const savedReply = await Message.findById(replyRes.body._id);
    expect(savedReply).not.toBeNull();
    expect(savedReply.senderRole).toBe('user');
  });

  it('11. Active user cannot initiate direct conversation with Super Admin', async () => {
    const res = await request(app)
      .post(`/api/chat/conversations/${adminProfile._id}`)
      .set('Authorization', 'Bearer reporter_uid');

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Direct chat with Super Admin is not permitted');
  });

  it('12. Active user cannot send direct chat message to Super Admin in moderation conversation', async () => {
    // Admin sent report message to active reporter
    const adminMsg = await request(app)
      .post(`/api/admin/reports/${report._id}/message`)
      .set('Authorization', 'Bearer super_admin_uid')
      .send({ recipientType: 'reporter', message: 'Official report notice' });

    const convId = adminMsg.body.conversationId;

    // Active reporter attempts to send direct chat message into moderation conversation
    const replyRes = await request(app)
      .post(`/api/chat/conversations/${convId}/messages`)
      .set('Authorization', 'Bearer reporter_uid')
      .send({ text: 'Attempting to reply directly to admin' });

    expect(replyRes.status).toBe(403);
    expect(replyRes.body.message).toBe('Direct chat with Super Admin is not permitted');
  });

  it('13. Normal friend chat is permitted between connected users, but rejected for unconnected users', async () => {
    // Unconnected users cannot chat
    const unconnectedRes = await request(app)
      .post(`/api/chat/conversations/${unrelatedUser._id}`)
      .set('Authorization', 'Bearer reporter_uid');

    expect(unconnectedRes.status).toBe(403);
    expect(unconnectedRes.body.message).toBe('Cannot chat with users who are not connected friends');

    // Create accepted connection between reporterUser and unrelatedUser
    await Connection.create({
      requester: reporterUser._id,
      recipient: unrelatedUser._id,
      status: 'accepted'
    });

    // Connected users can create conversation
    const connectedRes = await request(app)
      .post(`/api/chat/conversations/${unrelatedUser._id}`)
      .set('Authorization', 'Bearer reporter_uid');

    expect(connectedRes.status).toBe(200);
    expect(connectedRes.body.isModeration).toBe(false);

    // Connected users can send message
    const msgRes = await request(app)
      .post(`/api/chat/conversations/${connectedRes.body._id}/messages`)
      .set('Authorization', 'Bearer reporter_uid')
      .send({ text: 'Hello friend!', clientMessageId: crypto.randomUUID() });

    expect(msgRes.status).toBe(201);
    expect(msgRes.body.senderRole).toBe('user');
    expect(msgRes.body.text).toBe('Hello friend!');
  });

  it('14. Suspended user cannot initiate normal friend chat', async () => {
    // Create friend connection
    await Connection.create({
      requester: reportedUser._id,
      recipient: unrelatedUser._id,
      status: 'accepted'
    });

    // Suspend reportedUser
    await UserProfile.findByIdAndUpdate(reportedUser._id, { accountStatus: 'suspended' });

    const res = await request(app)
      .post(`/api/chat/conversations/${unrelatedUser._id}`)
      .set('Authorization', 'Bearer reported_uid');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_SUSPENDED');
  });
});
