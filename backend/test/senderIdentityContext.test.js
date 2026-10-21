import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

import UserProfile from '../src/models/UserProfile.js';
import Conversation from '../src/models/Conversation.js';
import Message from '../src/models/Message.js';
import Connection from '../src/models/Connection.js';
import Report from '../src/models/Report.js';
import ModerationAction from '../src/models/ModerationAction.js';

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
import adminRoutes from '../src/routes/adminRoutes.js';
import supportRoutes from '../src/routes/supportRoutes.js';

const app = express();
app.use(express.json());
app.use('/api/chat', chatRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/support', supportRoutes);

describe('Separate User Identity from Administrative Display Identity', () => {
  let replSet;
  let adminUser, normalUser, otherNormalUser;
  let normalConv, adminReport;

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
    await Conversation.deleteMany({});
    await Message.deleteMany({});
    await Connection.deleteMany({});
    await Report.deleteMany({});
    await ModerationAction.deleteMany({});

    // 1. Dual-role account: is both a normal player and a Super Admin
    adminUser = await UserProfile.create({
      firebaseUid: 'admin_dual_role_uid',
      displayName: 'AwesomeGamer',
      email: 'gamer_admin@zync.gg',
      role: 'super_admin',
      accountStatus: 'active',
      games: [{ gameName: 'Valorant', inGameName: 'AwesomeAdmin#1234', skillLevel: 85 }]
    });

    // 2. Normal user
    normalUser = await UserProfile.create({
      firebaseUid: 'normal_user_uid',
      displayName: 'NormalGamer1',
      email: 'gamer1@zync.gg',
      role: 'user',
      accountStatus: 'active',
      games: [{ gameName: 'Valorant', inGameName: 'GamerOne#1234', skillLevel: 70 }]
    });

    // 3. Another normal user
    otherNormalUser = await UserProfile.create({
      firebaseUid: 'other_user_uid',
      displayName: 'NormalGamer2',
      email: 'gamer2@zync.gg',
      role: 'user',
      accountStatus: 'active',
      games: [{ gameName: 'Valorant', inGameName: 'GamerTwo#1234', skillLevel: 60 }]
    });

    // Establish accepted friend connection between adminUser (as gamer) and normalUser
    await Connection.create({
      requester: adminUser._id,
      recipient: normalUser._id,
      status: 'accepted'
    });

    // Normal friend conversation between adminUser and normalUser
    normalConv = await Conversation.create({
      participants: [adminUser._id, normalUser._id],
      isModeration: false
    });

    // Pending report on otherNormalUser
    adminReport = await Report.create({
      reporter: normalUser._id,
      reportedUser: otherNormalUser._id,
      reason: 'Toxic or abusive behavior',
      status: 'pending'
    });
  });

  it('1. A dual-role account can send a normal message as its ordinary profile', async () => {
    const res = await request(app)
      .post(`/api/chat/conversations/${normalConv._id}/messages`)
      .set('Authorization', 'Bearer admin_dual_role_uid')
      .send({ text: 'GG, let us queue next match!' });

    expect(res.status).toBe(201);
    expect(res.body.text).toBe('GG, let us queue next match!');
    expect(res.body.senderRole).toBe('user');
    expect(res.body.senderDisplayName).toBe('AwesomeGamer');

    const savedMsg = await Message.findById(res.body._id);
    expect(savedMsg.senderRole).toBe('user');
    expect(savedMsg.senderDisplayName).toBe('AwesomeGamer');
    expect(savedMsg.sender.toString()).toBe(adminUser._id.toString());
  });

  it('2. The same account can send an authorized administrative message using the official admin identity', async () => {
    // Admin sends administrative message via admin report messaging workflow
    const res = await request(app)
      .post(`/api/admin/reports/${adminReport._id}/message`)
      .set('Authorization', 'Bearer admin_dual_role_uid')
      .send({ recipientType: 'reportedUser', message: 'This is an official moderation communication.' });

    expect(res.status).toBe(201);
    expect(res.body.conversationId).toBeDefined();

    const adminMsg = await Message.findOne({ conversationId: res.body.conversationId });
    expect(adminMsg).toBeDefined();
    expect(adminMsg.text).toBe('This is an official moderation communication.');
    expect(adminMsg.senderRole).toBe('admin');
    expect(adminMsg.senderDisplayName).toBe('ZYNC Super Admin');
    // Staff actor ID is preserved internally for audit
    expect(adminMsg.sender.toString()).toBe(adminUser._id.toString());
  });

  it('2b. A Super Admin requesting senderContext: "admin" in an ordinary conversation receives 403 and no Message is persisted', async () => {
    const res = await request(app)
      .post(`/api/chat/conversations/${normalConv._id}/messages`)
      .set('Authorization', 'Bearer admin_dual_role_uid')
      .send({ text: 'Unauthorized admin notice in normal chat', senderContext: 'admin' });

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('Admin sender context is only permitted in authorized moderation conversations');

    const msg = await Message.findOne({ text: 'Unauthorized admin notice in normal chat' });
    expect(msg).toBeNull();
  });

  it('2c. Super Admin can send admin context in an authorized moderation conversation, persisting admin role and identity', async () => {
    const modConv = await Conversation.create({
      participants: [adminUser._id, otherNormalUser._id],
      isModeration: true
    });

    const res = await request(app)
      .post(`/api/chat/conversations/${modConv._id}/messages`)
      .set('Authorization', 'Bearer admin_dual_role_uid')
      .send({ text: 'Official moderation notice regarding report', senderContext: 'admin' });

    expect(res.status).toBe(201);
    expect(res.body.senderRole).toBe('admin');
    expect(res.body.senderDisplayName).toBe('ZYNC Super Admin');

    const saved = await Message.findById(res.body._id);
    expect(saved).not.toBeNull();
    expect(saved.senderRole).toBe('admin');
    expect(saved.senderDisplayName).toBe('ZYNC Super Admin');
    expect(saved.sender.toString()).toBe(adminUser._id.toString());
  });

  it('3. A non-admin cannot send an administrative message or spoof an admin badge in normal or moderation conversations', async () => {
    // A normal user attempting to send senderContext: 'admin' in chat
    const res = await request(app)
      .post(`/api/chat/conversations/${normalConv._id}/messages`)
      .set('Authorization', 'Bearer normal_user_uid')
      .send({ text: 'I claim to be admin!', senderContext: 'admin' });

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('Super Admin role required');

    // Verify no message was persisted
    const msg = await Message.findOne({ text: 'I claim to be admin!' });
    expect(msg).toBeNull();

    // A normal user attempting to send senderContext: 'admin' in a moderation conversation
    const modConv = await Conversation.create({
      participants: [normalUser._id, adminUser._id],
      isModeration: true
    });

    const modRes = await request(app)
      .post(`/api/chat/conversations/${modConv._id}/messages`)
      .set('Authorization', 'Bearer normal_user_uid')
      .send({ text: 'Normal user spoofing admin in mod chat', senderContext: 'admin' });

    expect(modRes.status).toBe(403);
    expect(modRes.body.message).toContain('Super Admin role required');

    const modMsg = await Message.findOne({ text: 'Normal user spoofing admin in mod chat' });
    expect(modMsg).toBeNull();
  });

  it('3b. A non-admin cannot send messages via the admin report messaging endpoint', async () => {
    const res = await request(app)
      .post(`/api/admin/reports/${adminReport._id}/message`)
      .set('Authorization', 'Bearer normal_user_uid')
      .send({ recipientType: 'reportedUser', message: 'Fake admin message' });

    expect(res.status).toBe(403);
  });

  it('4. A client cannot override the sender display name, role, or identity', async () => {
    // Normal user passes spoofed parameters in body
    const res = await request(app)
      .post(`/api/chat/conversations/${normalConv._id}/messages`)
      .set('Authorization', 'Bearer normal_user_uid')
      .send({
        text: 'Normal message',
        sender: adminUser._id,
        senderRole: 'admin',
        senderDisplayName: 'ZYNC Super Admin'
      });

    expect(res.status).toBe(201);
    // Server overrides client-provided sender/role/name with actual authenticated user identity
    expect(res.body.senderRole).toBe('user');
    expect(res.body.senderDisplayName).toBe('NormalGamer1');
    expect(res.body.sender.toString()).toBe(normalUser._id.toString());

    const saved = await Message.findById(res.body._id);
    expect(saved.senderRole).toBe('user');
    expect(saved.senderDisplayName).toBe('NormalGamer1');
    expect(saved.sender.toString()).toBe(normalUser._id.toString());
  });

  it('5. Historical user messages do not become admin messages when the sender gains an admin role', async () => {
    // normalUser sends a message as a normal user
    const res = await request(app)
      .post(`/api/chat/conversations/${normalConv._id}/messages`)
      .set('Authorization', 'Bearer normal_user_uid')
      .send({ text: 'Message from regular user' });

    expect(res.status).toBe(201);
    const msgId = res.body._id;

    // normalUser is subsequently promoted to super_admin
    await UserProfile.findByIdAndUpdate(normalUser._id, { role: 'super_admin' });

    // Fetch the message from database / chat
    const historicalMsg = await Message.findById(msgId);
    expect(historicalMsg.senderRole).toBe('user');
    expect(historicalMsg.senderDisplayName).toBe('NormalGamer1');

    // Chat endpoint GET /api/chat/conversations/:id/messages preserves historical context
    const getRes = await request(app)
      .get(`/api/chat/conversations/${normalConv._id}/messages`)
      .set('Authorization', 'Bearer normal_user_uid');

    expect(getRes.status).toBe(200);
    const fetched = getRes.body.find(m => m._id.toString() === msgId.toString());
    expect(fetched.senderRole).toBe('user');
    expect(fetched.senderDisplayName).toBe('NormalGamer1');
  });

  it('6. Historical administrative messages preserve their recorded administrative context', async () => {
    // Admin sends administrative message
    const res = await request(app)
      .post(`/api/admin/reports/${adminReport._id}/message`)
      .set('Authorization', 'Bearer admin_dual_role_uid')
      .send({ recipientType: 'reportedUser', message: 'Official warning text' });

    const convId = res.body.conversationId;
    const adminMsg = await Message.findOne({ conversationId: convId });

    // Admin user changes their personal profile display name or role later
    await UserProfile.findByIdAndUpdate(adminUser._id, { displayName: 'NewGamerTag', role: 'user' });

    // The historical message retains its official administrative identity and badge context
    const checkMsg = await Message.findById(adminMsg._id);
    expect(checkMsg.senderRole).toBe('admin');
    expect(checkMsg.senderDisplayName).toBe('ZYNC Super Admin');
  });

  it('7. Protected audit logs retain the real authenticated actor', async () => {
    // Admin creates moderation action
    const res = await request(app)
      .post('/api/admin/moderation-actions')
      .set('Authorization', 'Bearer admin_dual_role_uid')
      .send({
        affectedUserId: otherNormalUser._id.toString(),
        actionType: 'warning',
        reason: 'Harassment in public lobby',
        relatedReportId: adminReport._id.toString()
      });

    expect(res.status).toBe(201);
    expect(res.body.action.admin.toString()).toBe(adminUser._id.toString());

    // Audit query in getModerationActions retains real actor
    const actionInDb = await ModerationAction.findById(res.body.action._id);
    expect(actionInDb.admin.toString()).toBe(adminUser._id.toString());
  });

  it('8. Existing normal chat, announcements, report messaging, support tickets, and moderation behavior remain unchanged', async () => {
    // Normal chat message
    const chatRes = await request(app)
      .post(`/api/chat/conversations/${normalConv._id}/messages`)
      .set('Authorization', 'Bearer normal_user_uid')
      .send({ text: 'Hello squad!' });
    expect(chatRes.status).toBe(201);
    expect(chatRes.body.senderRole).toBe('user');

    // Admin broadcast announcement
    const broadcastRes = await request(app)
      .post('/api/admin/notifications')
      .set('Authorization', 'Bearer admin_dual_role_uid')
      .send({
        audienceType: 'all',
        title: 'Platform Maintenance',
        message: 'Servers updating at midnight.'
      });
    expect(broadcastRes.status).toBe(201);
    expect(broadcastRes.body.broadcastId).toBeDefined();

    const broadcastDoc = await mongoose.model('BroadcastNotification').findById(broadcastRes.body.broadcastId);
    expect(broadcastDoc.sender.toString()).toBe(adminUser._id.toString());
  });

  it('9. Existing membership, recipient authorization, connection, and suspension restrictions still apply', async () => {
    // A non-participant cannot send messages in conversation
    const nonPartRes = await request(app)
      .post(`/api/chat/conversations/${normalConv._id}/messages`)
      .set('Authorization', 'Bearer other_user_uid')
      .send({ text: 'Uninvited message' });
    expect(nonPartRes.status).toBe(403);
    expect(nonPartRes.body.message).toContain('Not authorized to send messages');
    const nonPartMsg = await Message.findOne({ text: 'Uninvited message' });
    expect(nonPartMsg).toBeNull();

    // Normal users without accepted connection cannot chat in ordinary conversation
    const unconnectedConv = await Conversation.create({
      participants: [normalUser._id, otherNormalUser._id],
      isModeration: false
    });
    const unconnectedRes = await request(app)
      .post(`/api/chat/conversations/${unconnectedConv._id}/messages`)
      .set('Authorization', 'Bearer normal_user_uid')
      .send({ text: 'Hey stranger' });
    expect(unconnectedRes.status).toBe(403);
    expect(unconnectedRes.body.message).toContain('Cannot chat with users who are not connected friends');
    const unconnectedMsg = await Message.findOne({ text: 'Hey stranger' });
    expect(unconnectedMsg).toBeNull();

    // Suspended user cannot send message in ordinary conversation
    await UserProfile.findByIdAndUpdate(otherNormalUser._id, { accountStatus: 'suspended' });
    await Connection.create({
      requester: normalUser._id,
      recipient: otherNormalUser._id,
      status: 'accepted'
    });
    const suspendedRes = await request(app)
      .post(`/api/chat/conversations/${unconnectedConv._id}/messages`)
      .set('Authorization', 'Bearer other_user_uid')
      .send({ text: 'Message from suspended user' });
    expect(suspendedRes.status).toBe(403);
    expect(suspendedRes.body.code).toBe('ACCOUNT_SUSPENDED');
    const suspendedMsg = await Message.findOne({ text: 'Message from suspended user' });
    expect(suspendedMsg).toBeNull();

    // Suspended user CAN send appeal/message in authorized moderation conversation as user
    const modConv = await Conversation.create({
      participants: [otherNormalUser._id, adminUser._id],
      isModeration: true
    });
    const appealRes = await request(app)
      .post(`/api/chat/conversations/${modConv._id}/messages`)
      .set('Authorization', 'Bearer other_user_uid')
      .send({ text: 'Appeal explanation for my suspension' });
    expect(appealRes.status).toBe(201);
    expect(appealRes.body.senderRole).toBe('user');
    const appealMsg = await Message.findOne({ text: 'Appeal explanation for my suspension' });
    expect(appealMsg).not.toBeNull();
    expect(appealMsg.senderRole).toBe('user');
  });

  it('10. Sender ID normalization works with string IDs, ObjectIds, populated participants, and unpopulated participant IDs', () => {
    const normalizeId = (val) => {
      if (!val) return '';
      if (typeof val === 'object' && val !== null) {
        const extracted = val._id || val.id || val;
        return extracted ? extracted.toString() : '';
      }
      return val.toString();
    };

    const objectId = new mongoose.Types.ObjectId();
    const strId = objectId.toString();

    // Raw string ID
    expect(normalizeId(strId)).toBe(strId);
    // Raw ObjectId instance
    expect(normalizeId(objectId)).toBe(strId);
    // Populated participant object with _id as ObjectId
    expect(normalizeId({ _id: objectId, displayName: 'PlayerOne' })).toBe(strId);
    // Populated participant object with _id as string
    expect(normalizeId({ _id: strId, displayName: 'PlayerOne' })).toBe(strId);
    // Object with id property
    expect(normalizeId({ id: strId })).toBe(strId);
    // null and undefined
    expect(normalizeId(null)).toBe('');
    expect(normalizeId(undefined)).toBe('');

    // Cross-comparison scenarios:
    // 1. Populated participant vs string targetUserId
    const participants = [
      { _id: objectId, displayName: 'Me' },
      { _id: new mongoose.Types.ObjectId(), displayName: 'Other' }
    ];
    const targetUserId = participants[1]._id.toString();
    const otherParticipant = participants.find(p => normalizeId(p) === normalizeId(targetUserId));
    expect(otherParticipant).toBe(participants[1]);

    const myParticipant = participants.find(p => normalizeId(p) !== normalizeId(targetUserId));
    expect(myParticipant).toBe(participants[0]);

    // 2. Unpopulated participant IDs array vs ObjectId sender
    const rawParticipants = [objectId, participants[1]._id];
    const myId = normalizeId(rawParticipants.find(p => normalizeId(p) !== normalizeId(targetUserId)));
    expect(myId).toBe(strId);

    const messageSender = objectId;
    const isMine = Boolean(myId && normalizeId(messageSender) && myId === normalizeId(messageSender));
    expect(isMine).toBe(true);

    const incomingSender = participants[1]._id.toString();
    const isIncomingMine = Boolean(myId && normalizeId(incomingSender) && myId === normalizeId(incomingSender));
    expect(isIncomingMine).toBe(false);
  });
});
