import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

import UserProfile from '../src/models/UserProfile.js';
import SupportTicket from '../src/models/SupportTicket.js';
import ModerationAction from '../src/models/ModerationAction.js';
import Conversation from '../src/models/Conversation.js';
import Message from '../src/models/Message.js';
import Notification from '../src/models/Notification.js';

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

import supportRoutes from '../src/routes/supportRoutes.js';
import chatRoutes from '../src/routes/chatRoutes.js';
import { supportCreationRateLimiter } from '../src/middleware/rateLimitMiddleware.js';

const app = express();
app.use(express.json());
app.use('/api/support', supportRoutes);
app.use('/api/chat', chatRoutes);

describe('Dedicated Support Ticket System', () => {
  let replSet;
  let activeUser, suspendedUser, otherUser, staffUser;

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
    await SupportTicket.deleteMany({});
    await ModerationAction.deleteMany({});
    await Conversation.deleteMany({});
    await Message.deleteMany({});
    await Notification.deleteMany({});

    activeUser = await UserProfile.create({
      firebaseUid: 'active_uid',
      email: 'active@zync.gg',
      displayName: 'ActiveGamer',
      role: 'user',
      accountStatus: 'active'
    });

    suspendedUser = await UserProfile.create({
      firebaseUid: 'suspended_uid',
      email: 'suspended@zync.gg',
      displayName: 'SuspendedGamer',
      role: 'user',
      accountStatus: 'suspended'
    });

    otherUser = await UserProfile.create({
      firebaseUid: 'other_uid',
      email: 'other@zync.gg',
      displayName: 'OtherGamer',
      role: 'user',
      accountStatus: 'active'
    });

    staffUser = await UserProfile.create({
      firebaseUid: 'staff_uid',
      email: 'staff@zync.gg',
      displayName: 'SupportLead',
      role: 'super_admin',
      accountStatus: 'active'
    });
  });

  it('1. Ticket creation generates server-controlled ticket number, creator, status, and does NOT create a Conversation', async () => {
    const res = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', 'Bearer active_uid')
      .send({
        category: 'billing',
        subject: 'Invoice question for battle pass',
        message: 'Where can I see my itemized receipt?',
        // Attempting to spoof fields:
        ticketNumber: 'SPOOFED-123',
        status: 'resolved',
        creator: staffUser._id.toString()
      });

    expect(res.status).toBe(201);
    expect(res.body.ticketNumber).toMatch(/^TCK-\d{8}-\d{4}$/);
    expect(res.body.ticketNumber).not.toBe('SPOOFED-123');
    expect(res.body.status).toBe('open');
    expect(res.body.creator.toString()).toBe(activeUser._id.toString());
    expect(res.body.messages).toHaveLength(1);
    expect(res.body.messages[0].senderRole).toBe('user');
    expect(res.body.messages[0].text).toBe('Where can I see my itemized receipt?');

    // Verify ZERO Conversation or Message documents were created
    const convCount = await Conversation.countDocuments();
    const msgCount = await Message.countDocuments();
    expect(convCount).toBe(0);
    expect(msgCount).toBe(0);
  });

  it('2. User can list only their own tickets', async () => {
    // Active user ticket
    await request(app)
      .post('/api/support/tickets')
      .set('Authorization', 'Bearer active_uid')
      .send({ category: 'bug_report', subject: 'Map glitch', message: 'Fell through ground' });

    // Other user ticket
    await request(app)
      .post('/api/support/tickets')
      .set('Authorization', 'Bearer other_uid')
      .send({ category: 'general', subject: 'Feature question', message: 'Crossplay supported?' });

    const listRes = await request(app)
      .get('/api/support/tickets')
      .set('Authorization', 'Bearer active_uid');

    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].subject).toBe('Map glitch');
  });

  it('3. User cannot access or retrieve another user ticket', async () => {
    const createRes = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', 'Bearer active_uid')
      .send({ category: 'harassment_inquiry', subject: 'Lobby incident', message: 'Details here' });

    const ticketId = createRes.body._id;

    const unauthorizedRes = await request(app)
      .get(`/api/support/tickets/${ticketId}`)
      .set('Authorization', 'Bearer other_uid');

    expect(unauthorizedRes.status).toBe(403);
    expect(unauthorizedRes.body.message).toContain('Not authorized to view this ticket');
  });

  it('4. User reply appends to thread and transitions status if needed', async () => {
    const createRes = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', 'Bearer active_uid')
      .send({ category: 'general', subject: 'Question', message: 'Initial question' });

    const ticketId = createRes.body._id;

    // Staff sets status to waiting_on_user
    await SupportTicket.findByIdAndUpdate(ticketId, { status: 'waiting_on_user' });

    const replyRes = await request(app)
      .post(`/api/support/tickets/${ticketId}/reply`)
      .set('Authorization', 'Bearer active_uid')
      .send({ text: 'Here is the requested extra info' });

    expect(replyRes.status).toBe(201);
    expect(replyRes.body.messages).toHaveLength(2);
    expect(replyRes.body.status).toBe('open'); // Re-opened because user responded
  });

  it('5. Suspended user can submit an appeal ticket and view their ticket details without platform chat access', async () => {
    // Record a moderation action for suspension
    const modAction = await ModerationAction.create({
      affectedUser: suspendedUser._id,
      actionType: 'temporary_suspension',
      reason: 'Toxic behavior in competitive match',
      admin: staffUser._id
    });

    const appealRes = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', 'Bearer suspended_uid')
      .send({
        category: 'suspension_appeal',
        subject: 'Appeal for account suspension',
        message: 'I understand my actions and have taken steps to reform.'
      });

    expect(appealRes.status).toBe(201);
    expect(appealRes.body.category).toBe('suspension_appeal');
    expect(appealRes.body.priority).toBe('high');
    expect(appealRes.body.hasRelatedModerationAction).toBe(true);

    const ticketId = appealRes.body._id;

    // Suspended user can read details and public messages
    const getRes = await request(app)
      .get(`/api/support/tickets/${ticketId}`)
      .set('Authorization', 'Bearer suspended_uid');

    expect(getRes.status).toBe(200);
    expect(getRes.body.messages).toHaveLength(1);

    // But suspended user CANNOT access normal chat or start direct chat
    const chatAttempt = await request(app)
      .post(`/api/chat/conversations/${otherUser._id}`)
      .set('Authorization', 'Bearer suspended_uid');

    expect(chatAttempt.status).toBe(403);
    expect(chatAttempt.body.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('6. Suspended user cannot submit unrelated categories (e.g. bug_report, billing)', async () => {
    const res = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', 'Bearer suspended_uid')
      .send({
        category: 'bug_report',
        subject: 'Bug report while suspended',
        message: 'Something is broken'
      });

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('Suspended users may only submit suspension appeals');
  });

  it('7. Staff can view all tickets, filter, assign, update priority/status, and add internal notes', async () => {
    const t1 = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', 'Bearer active_uid')
      .send({ category: 'bug_report', subject: 'Inventory missing', message: 'Item disappeared' });

    const ticketId = t1.body._id;

    // Staff lists tickets
    const staffList = await request(app)
      .get('/api/support/admin/tickets?category=bug_report')
      .set('Authorization', 'Bearer staff_uid');

    expect(staffList.status).toBe(200);
    expect(staffList.body.tickets).toHaveLength(1);

    // Staff updates meta (assigns self, sets high priority, sets in_progress)
    const updateRes = await request(app)
      .patch(`/api/support/admin/tickets/${ticketId}`)
      .set('Authorization', 'Bearer staff_uid')
      .send({
        status: 'in_progress',
        priority: 'high',
        assignedStaff: staffUser._id.toString()
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.status).toBe('in_progress');
    expect(updateRes.body.priority).toBe('high');

    // Staff adds internal note
    const noteRes = await request(app)
      .post(`/api/support/admin/tickets/${ticketId}/notes`)
      .set('Authorization', 'Bearer staff_uid')
      .send({ note: 'Verified database logs: transaction rolled back due to network glitch.' });

    expect(noteRes.status).toBe(201);
    expect(noteRes.body.internalNotes).toHaveLength(1);
    expect(noteRes.body.internalNotes[0].note).toContain('Verified database logs');

    // Verify ordinary user NEVER receives internalNotes in their DTO
    const userFetch = await request(app)
      .get(`/api/support/tickets/${ticketId}`)
      .set('Authorization', 'Bearer active_uid');

    expect(userFetch.status).toBe(200);
    expect(userFetch.body.internalNotes).toBeUndefined();
  });

  it('8. Non-staff user cannot access staff routes or post internal notes', async () => {
    const t1 = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', 'Bearer active_uid')
      .send({ category: 'billing', subject: 'Invoice', message: 'Details' });

    const ticketId = t1.body._id;

    // Non-staff tries to list staff tickets
    const listRes = await request(app)
      .get('/api/support/admin/tickets')
      .set('Authorization', 'Bearer active_uid');

    expect(listRes.status).toBe(403);

    // Non-staff tries to add internal note
    const noteRes = await request(app)
      .post(`/api/support/admin/tickets/${ticketId}/notes`)
      .set('Authorization', 'Bearer active_uid')
      .send({ note: 'Hacker note' });

    expect(noteRes.status).toBe(403);
  });

  it('9. Staff reply identifies as staff and sends in-app notification to ticket creator', async () => {
    const t1 = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', 'Bearer active_uid')
      .send({ category: 'general', subject: 'Discord link', message: 'Where is the official server?' });

    const ticketId = t1.body._id;

    const replyRes = await request(app)
      .post(`/api/support/tickets/${ticketId}/reply`)
      .set('Authorization', 'Bearer staff_uid')
      .send({ text: 'You can join us at discord.gg/zync' });

    expect(replyRes.status).toBe(201);
    const lastMsg = replyRes.body.messages[replyRes.body.messages.length - 1];
    expect(lastMsg.senderRole).toBe('staff');
    expect(lastMsg.senderDisplayName).toBe('ZYNC Support');

    // Verify in-app Notification was sent to activeUser
    const userNotification = await Notification.findOne({ recipient: activeUser._id });
    expect(userNotification).not.toBeNull();
    expect(userNotification.title).toContain('Reply to Ticket');
    expect(userNotification.message).toContain('discord.gg/zync');
  });

  it('10. Validation enforces category enum and character limits', async () => {
    // Invalid category
    const badCat = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', 'Bearer active_uid')
      .send({ category: 'invalid_category', subject: 'Test', message: 'Test message' });
    expect(badCat.status).toBe(400);

    // Missing subject
    const noSubj = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', 'Bearer active_uid')
      .send({ category: 'general', subject: '   ', message: 'Test message' });
    expect(noSubj.status).toBe(400);

    // Empty message
    const emptyMsg = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', 'Bearer active_uid')
      .send({ category: 'general', subject: 'Test', message: '' });
    expect(emptyMsg.status).toBe(400);
  });

  describe('Staff Ticket Safe Search Handling (SEC-01)', () => {
    let specialTicket;

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/support/tickets')
        .set('Authorization', 'Bearer active_uid')
        .send({
          category: 'bug_report',
          subject: '[CRITICAL] Game client crash + lag (v1.0)?',
          message: 'Client crashes when opening inventory.'
        });
      specialTicket = res.body;
    });

    it('11a. Malformed regex characters do not crash the staff ticket search endpoint', async () => {
      const malformedQueries = ['[', '*', '(', '+', '?', '^', '$', '(?=test)', '\\'];
      for (const char of malformedQueries) {
        const res = await request(app)
          .get(`/api/support/admin/tickets?search=${encodeURIComponent(char)}`)
          .set('Authorization', 'Bearer staff_uid');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('tickets');
      }
    });

    it('11b. Regex characters are treated literally rather than as pattern syntax in ticket search', async () => {
      // Search literally for '[CRITICAL]'
      const bracketSearch = await request(app)
        .get(`/api/support/admin/tickets?search=${encodeURIComponent('[CRITICAL]')}`)
        .set('Authorization', 'Bearer staff_uid');
      expect(bracketSearch.status).toBe(200);
      expect(bracketSearch.body.tickets.length).toBe(1);
      expect(bracketSearch.body.tickets[0].subject).toContain('[CRITICAL]');

      // Search literally for '+ lag'
      const plusSearch = await request(app)
        .get(`/api/support/admin/tickets?search=${encodeURIComponent('+ lag')}`)
        .set('Authorization', 'Bearer staff_uid');
      expect(plusSearch.status).toBe(200);
      expect(plusSearch.body.tickets.length).toBe(1);
      expect(plusSearch.body.tickets[0].subject).toContain('+ lag');

      // Character class pattern '[A-Z]' should NOT match as a regex character class
      const charClassSearch = await request(app)
        .get(`/api/support/admin/tickets?search=${encodeURIComponent('[A-Z]')}`)
        .set('Authorization', 'Bearer staff_uid');
      expect(charClassSearch.status).toBe(200);
      expect(charClassSearch.body.tickets.length).toBe(0);

      // Search literally for ticketNumber prefix 'TCK-'
      const ticketNumSearch = await request(app)
        .get(`/api/support/admin/tickets?search=TCK-`)
        .set('Authorization', 'Bearer staff_uid');
      expect(ticketNumSearch.status).toBe(200);
      expect(ticketNumSearch.body.tickets.length).toBeGreaterThanOrEqual(1);

      // Search literally for email
      const emailSearch = await request(app)
        .get(`/api/support/admin/tickets?search=active@zync.gg`)
        .set('Authorization', 'Bearer staff_uid');
      expect(emailSearch.status).toBe(200);
      expect(emailSearch.body.tickets.length).toBeGreaterThanOrEqual(1);
    });

    it('11c. Empty search and whitespace-only search return all tickets without error', async () => {
      const emptyRes = await request(app)
        .get('/api/support/admin/tickets?search=')
        .set('Authorization', 'Bearer staff_uid');
      expect(emptyRes.status).toBe(200);
      expect(emptyRes.body.tickets.length).toBeGreaterThanOrEqual(1);

      const whitespaceRes = await request(app)
        .get('/api/support/admin/tickets?search=%20%20%20')
        .set('Authorization', 'Bearer staff_uid');
      expect(whitespaceRes.status).toBe(200);
      expect(whitespaceRes.body.tickets.length).toBeGreaterThanOrEqual(1);
    });

    it('11d. Search query exceeding 100 characters returns 400 Bad Request', async () => {
      const longQuery = 'b'.repeat(101);
      const res = await request(app)
        .get(`/api/support/admin/tickets?search=${longQuery}`)
        .set('Authorization', 'Bearer staff_uid');
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Search query exceeds maximum length of 100 characters');
    });

    it('11e. Non-string search query parameter returns 400 Bad Request', async () => {
      const res = await request(app)
        .get('/api/support/admin/tickets?search=ticket1&search=ticket2')
        .set('Authorization', 'Bearer staff_uid');
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Search query must be a string');
    });
  });
});

