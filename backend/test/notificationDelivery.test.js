import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import express from 'express';

import { connectTestDB, closeTestDB, clearTestDB } from './setup.js';
import UserProfile from '../src/models/UserProfile.js';
import Notification from '../src/models/Notification.js';
import BroadcastNotification from '../src/models/BroadcastNotification.js';
import SupportTicket from '../src/models/SupportTicket.js';
import ModerationAction from '../src/models/ModerationAction.js';

import {
  formatNotificationPayload,
  resolveRecipientRoom,
  deliverNotification,
  deliverBulkNotifications
} from '../src/services/notificationService.js';
import * as socketConfig from '../src/config/socket.js';

// Setup hoisted mocks for auth middleware
const authState = vi.hoisted(() => ({
  currentUser: null
}));

vi.mock('../src/middleware/authMiddleware.js', () => ({
  verifyToken: (req, res, next) => {
    if (!authState.currentUser) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    req.user = authState.currentUser;
    next();
  }
}));

vi.mock('../src/middleware/adminMiddleware.js', () => ({
  verifySuperAdmin: (req, res, next) => {
    if (authState.currentUser?.role !== 'super_admin') {
      return res.status(403).json({ message: 'Forbidden' });
    }
    next();
  }
}));

import adminRoutes from '../src/routes/adminRoutes.js';
import supportRoutes from '../src/routes/supportRoutes.js';
import notificationRoutes from '../src/routes/notificationRoutes.js';
import connectionRoutes from '../src/routes/connectionRoutes.js';
import Connection from '../src/models/Connection.js';
import { connectionRequestRateLimiter } from '../src/middleware/rateLimitMiddleware.js';

const app = express();
app.use(express.json());
app.use('/api/admin', adminRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/connections', connectionRoutes);

describe('Checkpoint N2: Backend Notification Delivery & Validation', () => {
  let adminUser, activeUserVal, activeUserBrawl, suspendedUser;
  let emittedEvents = [];
  let mockIO;

  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    emittedEvents = [];

    // Construct chainable mock IO instance that records room emissions
    const createEmitter = (rooms = []) => ({
      to: (room) => createEmitter([...rooms, room]),
      emit: (event, payload) => {
        rooms.forEach(r => emittedEvents.push({ room: r, event, payload }));
      }
    });

    mockIO = {
      to: (room) => createEmitter([room])
    };
    vi.spyOn(socketConfig, 'getIO').mockReturnValue(mockIO);

    // Create test admin
    adminUser = await UserProfile.create({
      firebaseUid: 'uid-admin-1',
      email: 'admin@zync.test',
      displayName: 'Admin User',
      role: 'super_admin',
      accountStatus: 'active',
      games: []
    });

    // Create active user with Valorant
    activeUserVal = await UserProfile.create({
      firebaseUid: 'uid-val-1',
      email: 'val@zync.test',
      displayName: 'Val Gamer',
      role: 'user',
      accountStatus: 'active',
      games: [{
        gameName: 'Valorant',
        inGameName: 'ValPro',
        skillLevel: 80,
        roles: ['Duelist']
      }]
    });

    // Create active user with Brawl Stars
    activeUserBrawl = await UserProfile.create({
      firebaseUid: 'uid-brawl-1',
      email: 'brawl@zync.test',
      displayName: 'Brawl Gamer',
      role: 'user',
      accountStatus: 'active',
      games: [{
        gameName: 'Brawl Stars',
        inGameName: 'BrawlMaster',
        skillLevel: 50,
        roles: ['Healer']
      }]
    });

    // Create suspended user
    suspendedUser = await UserProfile.create({
      firebaseUid: 'uid-suspended-1',
      email: 'suspended@zync.test',
      displayName: 'Suspended Gamer',
      role: 'user',
      accountStatus: 'suspended',
      games: [{
        gameName: 'BGMI',
        inGameName: 'BGMIBanned',
        skillLevel: 40
      }]
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Centralized Notification Service Unit Tests', () => {
    it('formats notification document into minimum canonical payload', () => {
      const mockDoc = {
        _id: new mongoose.Types.ObjectId('6718a9b2c3d4e5f601234567'),
        title: 'System Announcement',
        message: 'Servers will update at midnight.',
        read: false,
        createdAt: new Date('2026-10-23T12:00:00.000Z')
      };

      const payload = formatNotificationPayload(mockDoc);
      expect(payload).toEqual({
        _id: '6718a9b2c3d4e5f601234567',
        title: 'System Announcement',
        message: 'Servers will update at midnight.',
        read: false,
        createdAt: '2026-10-23T12:00:00.000Z'
      });
      expect(payload.recipient).toBeUndefined();
    });

    it('extracts ticketNumber into payload when embedded in bracketed title', () => {
      const mockDoc = {
        _id: new mongoose.Types.ObjectId(),
        title: 'Reply to Ticket [TCK-20261023-8888]',
        message: 'Staff replied',
        read: false,
        createdAt: new Date()
      };

      const payload = formatNotificationPayload(mockDoc);
      expect(payload.ticketNumber).toBe('TCK-20261023-8888');
    });

    it('resolves room: active accounts receive on user:<id>, suspended receive on official:<id>', () => {
      const activeId = activeUserVal._id;
      const suspendedId = suspendedUser._id;

      expect(resolveRecipientRoom(activeId, 'active')).toBe(`user:${activeId}`);
      expect(resolveRecipientRoom(suspendedId, 'suspended')).toBe(`official:${suspendedId}`);
      expect(resolveRecipientRoom(activeId, undefined)).toBe(`user:${activeId}`);
    });

    it('prevents duplicate delivery: emits to exactly one room per recipient', async () => {
      const notifDoc = {
        _id: new mongoose.Types.ObjectId(),
        recipient: activeUserVal._id,
        title: 'Single Delivery',
        message: 'Ensure no room overlap',
        read: false,
        createdAt: new Date()
      };

      const emitted = await deliverNotification(notifDoc, {
        recipientId: activeUserVal._id,
        accountStatus: 'active'
      });

      expect(emitted).toBe(true);
      expect(emittedEvents.length).toBe(1);
      expect(emittedEvents[0].room).toBe(`user:${activeUserVal._id}`);
      expect(emittedEvents[0].event).toBe('notification:new');
    });

    it('gracefully handles missing Socket.IO instance without throwing', async () => {
      vi.spyOn(socketConfig, 'getIO').mockReturnValue(null);

      const notifDoc = {
        _id: new mongoose.Types.ObjectId(),
        recipient: activeUserVal._id,
        title: 'Test',
        message: 'Test'
      };

      const emitted = await deliverNotification(notifDoc);
      expect(emitted).toBe(false);
    });

    it('handles emission errors safely without throwing', async () => {
      vi.spyOn(socketConfig, 'getIO').mockReturnValue({
        to: () => ({
          emit: () => {
            throw new Error('Socket network socket error');
          }
        })
      });

      const notifDoc = {
        _id: new mongoose.Types.ObjectId(),
        recipient: activeUserVal._id,
        title: 'Test',
        message: 'Test'
      };

      const emitted = await deliverNotification(notifDoc);
      expect(emitted).toBe(false);
    });

    it('deliverBulkNotifications: isolates emission errors per recipient and reports accurate success count', async () => {
      const recipient1Id = new mongoose.Types.ObjectId();
      const recipient2Id = new mongoose.Types.ObjectId();

      const doc1 = {
        _id: new mongoose.Types.ObjectId(),
        recipient: recipient1Id,
        title: 'Title 1',
        message: 'Message 1'
      };
      const doc2 = {
        _id: new mongoose.Types.ObjectId(),
        recipient: recipient2Id,
        title: 'Title 2',
        message: 'Message 2'
      };

      const customEmitted = [];
      vi.spyOn(socketConfig, 'getIO').mockReturnValue({
        to: (room) => ({
          emit: (event, payload) => {
            if (room === `user:${recipient1Id}`) {
              throw new Error('Socket pipe error for recipient 1');
            }
            customEmitted.push({ room, event, payload });
          }
        })
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const count = await deliverBulkNotifications([doc1, doc2], {
        [recipient1Id.toString()]: 'active',
        [recipient2Id.toString()]: 'active'
      });

      // Recipient 1 failed, but Recipient 2 was still delivered successfully
      expect(count).toBe(1);
      expect(customEmitted.length).toBe(1);
      expect(customEmitted[0].room).toBe(`user:${recipient2Id}`);

      // Failure log includes recipient ID and error message, but does NOT leak notification message
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(recipient1Id.toString())
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Socket pipe error for recipient 1')
      );
      const loggedStrings = warnSpy.mock.calls.map(c => c.join(' ')).join(' ');
      expect(loggedStrings).not.toContain('Message 1');
    });

    it('deliverBulkNotifications: payload formatting failure on one item does not block subsequent recipients', async () => {
      const recipient1Id = new mongoose.Types.ObjectId();
      const recipient2Id = new mongoose.Types.ObjectId();

      // doc1 throws during formatting
      const doc1 = {
        _id: new mongoose.Types.ObjectId(),
        recipient: recipient1Id,
        get title() {
          throw new Error('Malformed title getter');
        }
      };
      const doc2 = {
        _id: new mongoose.Types.ObjectId(),
        recipient: recipient2Id,
        title: 'Title 2',
        message: 'Message 2'
      };

      const customEmitted = [];
      vi.spyOn(socketConfig, 'getIO').mockReturnValue({
        to: (room) => ({
          emit: (event, payload) => {
            customEmitted.push({ room, event, payload });
          }
        })
      });

      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const count = await deliverBulkNotifications([doc1, doc2], {
        [recipient1Id.toString()]: 'active',
        [recipient2Id.toString()]: 'active'
      });

      expect(count).toBe(1);
      expect(customEmitted.length).toBe(1);
      expect(customEmitted[0].room).toBe(`user:${recipient2Id}`);
    });
  });

  describe('2. Admin Broadcast Notifications & Game Targeting Validation', () => {
    beforeEach(() => {
      authState.currentUser = {
        _id: adminUser._id,
        uid: adminUser.firebaseUid,
        role: 'super_admin',
        accountStatus: 'active'
      };
    });

    it('rejects invalid targetGame when audienceType is "game" with 400', async () => {
      const res = await request(app)
        .post('/api/admin/notifications')
        .send({
          audienceType: 'game',
          targetGame: 'CounterStrike',
          title: 'Tournament Alert',
          message: 'Sign up now'
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid target game');
      expect(emittedEvents.length).toBe(0);
    });

    it('rejects lowercase/mismatched targetGame with 400', async () => {
      const res = await request(app)
        .post('/api/admin/notifications')
        .send({
          audienceType: 'game',
          targetGame: 'valorant', // Must be exact 'Valorant'
          title: 'Tournament Alert',
          message: 'Sign up now'
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid target game');
    });

    it('accepts valid targetGame (Valorant), persists documents, and emits only to Valorant users', async () => {
      const res = await request(app)
        .post('/api/admin/notifications')
        .send({
          audienceType: 'game',
          targetGame: 'Valorant',
          title: 'Valorant Cup',
          message: 'Matches begin Saturday.'
        });

      expect(res.status).toBe(201);
      expect(res.body.recipientCount).toBe(1);

      // Verify persistence
      const persisted = await Notification.find({ title: 'Valorant Cup' });
      expect(persisted.length).toBe(1);
      expect(persisted[0].recipient.toString()).toBe(activeUserVal._id.toString());

      // Verify Socket.IO emission to the persisted recipient
      expect(emittedEvents.length).toBe(1);
      expect(emittedEvents[0].room).toBe(`user:${activeUserVal._id}`);
      expect(emittedEvents[0].event).toBe('notification:new');
      expect(emittedEvents[0].payload._id).toBe(persisted[0]._id.toString());
      expect(emittedEvents[0].payload.title).toBe('Valorant Cup');
    });

    it('delivers bulk broadcasts corresponding to successfully inserted documents (excluding suspended users)', async () => {
      const res = await request(app)
        .post('/api/admin/notifications')
        .send({
          audienceType: 'all',
          title: 'Global Announcement',
          message: 'Platform maintenance tonight.'
        });

      expect(res.status).toBe(201);
      expect(res.body.recipientCount).toBe(3); // admin + 2 active (suspended excluded)

      const persisted = await Notification.find({ title: 'Global Announcement' });
      expect(persisted.length).toBe(3);

      // Emitted events must match confirmed documents
      expect(emittedEvents.length).toBe(3);

      // Verify room segregation: active users receive on user:<id>, suspended does not receive
      const activeValEvent = emittedEvents.find(e => e.room === `user:${activeUserVal._id}`);
      expect(activeValEvent).toBeDefined();

      const suspendedEvent = emittedEvents.find(e => e.room === `official:${suspendedUser._id}`);
      expect(suspendedEvent).toBeUndefined();
    });

    it('game broadcast targeting BGMI selects only active BGMI users and excludes suspended BGMI users', async () => {
      // Create an active BGMI user (suspendedUser already has BGMI and is suspended)
      const activeBgmiUser = await UserProfile.create({
        firebaseUid: 'uid-bgmi-active',
        email: 'bgmi@zync.test',
        displayName: 'Active BGMI Player',
        role: 'user',
        accountStatus: 'active',
        games: [{
          gameName: 'BGMI',
          inGameName: 'BGMIPro',
          skillLevel: 70
        }]
      });

      const res = await request(app)
        .post('/api/admin/notifications')
        .send({
          audienceType: 'game',
          targetGame: 'BGMI',
          title: 'BGMI Championship',
          message: 'Tournament registration open.'
        });

      expect(res.status).toBe(201);
      expect(res.body.recipientCount).toBe(1); // activeBgmiUser only, suspendedUser excluded

      const persisted = await Notification.find({ title: 'BGMI Championship' });
      expect(persisted.length).toBe(1);
      expect(persisted[0].recipient.toString()).toBe(activeBgmiUser._id.toString());

      expect(emittedEvents.length).toBe(1);
      expect(emittedEvents[0].room).toBe(`user:${activeBgmiUser._id}`);
      expect(emittedEvents.find(e => e.room === `official:${suspendedUser._id}`)).toBeUndefined();
    });

    it('individual-targeting sends to official:<id> when explicitly targeted', async () => {
      const res = await request(app)
        .post('/api/admin/notifications')
        .send({
          audienceType: 'individual',
          recipientId: suspendedUser._id.toString(),
          title: 'Account Status Notice',
          message: 'Please review your account standing.'
        });

      expect(res.status).toBe(201);
      expect(res.body.recipientCount).toBe(1);

      const persisted = await Notification.find({ title: 'Account Status Notice' });
      expect(persisted.length).toBe(1);
      expect(persisted[0].recipient.toString()).toBe(suspendedUser._id.toString());

      expect(emittedEvents.length).toBe(1);
      expect(emittedEvents[0].room).toBe(`official:${suspendedUser._id}`);
    });

    it('database failure during notification creation returns 500 and aborts delivery', async () => {
      vi.spyOn(Notification, 'insertMany').mockRejectedValueOnce(new Error('DB insert failure'));

      const res = await request(app)
        .post('/api/admin/notifications')
        .send({
          audienceType: 'all',
          title: 'Failing Broadcast',
          message: 'This will fail.'
        });

      expect(res.status).toBe(500);
      expect(emittedEvents.length).toBe(0);
      const persisted = await Notification.find({ title: 'Failing Broadcast' });
      expect(persisted.length).toBe(0);
    });

    it('socket emission failure does not turn completed broadcast into HTTP 500', async () => {
      // Mock IO to throw on emission
      vi.spyOn(socketConfig, 'getIO').mockReturnValue({
        to: () => ({
          emit: () => {
            throw new Error('Socket pipe error');
          }
        })
      });

      const res = await request(app)
        .post('/api/admin/notifications')
        .send({
          audienceType: 'individual',
          recipientId: activeUserBrawl._id.toString(),
          title: 'Individual Ping',
          message: 'Hello'
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      const count = await Notification.countDocuments({ title: 'Individual Ping' });
      expect(count).toBe(1);
    });

    it('admin broadcast bulk delivery isolates socket failures so healthy recipients still receive emissions', async () => {
      const customEmitted = [];
      vi.spyOn(socketConfig, 'getIO').mockReturnValue({
        to: (room) => ({
          emit: (event, payload) => {
            if (room === `user:${activeUserVal._id}`) {
              throw new Error('Socket pipe error for activeUserVal');
            }
            customEmitted.push({ room, event, payload });
          }
        })
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const res = await request(app)
        .post('/api/admin/notifications')
        .send({
          audienceType: 'all',
          title: 'Resilient Broadcast',
          message: 'Testing per-recipient failure isolation.'
        });

      expect(res.status).toBe(201);
      expect(res.body.recipientCount).toBe(3); // admin + 2 active

      // Persistent documents were all saved in DB
      const persisted = await Notification.find({ title: 'Resilient Broadcast' });
      expect(persisted.length).toBe(3);

      // Socket emission succeeded for healthy recipients (admin + activeUserBrawl), despite activeUserVal failing
      expect(customEmitted.length).toBe(2);
      expect(customEmitted.find(e => e.room === `user:${activeUserBrawl._id}`)).toBeDefined();

      // Log does not leak broadcast message body
      const logs = warnSpy.mock.calls.map(c => c.join(' ')).join(' ');
      expect(logs).not.toContain('Testing per-recipient failure isolation.');
    });
  });

  describe('3. Moderation Warnings Delivery', () => {
    beforeEach(() => {
      authState.currentUser = {
        _id: adminUser._id,
        uid: adminUser.firebaseUid,
        role: 'super_admin',
        accountStatus: 'active'
      };
    });

    it('emits notification:new when official warning action is created', async () => {
      const res = await request(app)
        .post('/api/admin/moderation-actions')
        .send({
          affectedUserId: activeUserVal._id.toString(),
          actionType: 'warning',
          reason: 'Unsportsmanlike conduct in chat'
        });

      expect(res.status).toBe(201);

      // Verify warning notification was persisted
      const warningNotif = await Notification.findOne({
        recipient: activeUserVal._id,
        title: 'Official Moderation Warning'
      });
      expect(warningNotif).toBeDefined();
      expect(warningNotif.message).toContain('Unsportsmanlike conduct in chat');

      // Verify Socket.IO emitted to active user
      const warningEvent = emittedEvents.find(e => e.payload?.title === 'Official Moderation Warning');
      expect(warningEvent).toBeDefined();
      expect(warningEvent.room).toBe(`user:${activeUserVal._id}`);
      expect(warningEvent.payload._id).toBe(warningNotif._id.toString());
    });

    it('does not emit notification:new when actionType is not warning', async () => {
      const res = await request(app)
        .post('/api/admin/moderation-actions')
        .send({
          affectedUserId: activeUserVal._id.toString(),
          actionType: 'temporary_suspension',
          reason: 'Severe violation',
          expiresAt: new Date(Date.now() + 86400000).toISOString()
        });

      expect(res.status).toBe(201);
      // Suspension does not create a warning Notification document
      const warningEvent = emittedEvents.find(e => e.payload?.title === 'Official Moderation Warning');
      expect(warningEvent).toBeUndefined();
    });
  });

  describe('4. Support Ticket Notification Delivery', () => {
    it('ticket creation emits notification:new to superadmins', async () => {
      authState.currentUser = {
        _id: activeUserVal._id,
        uid: activeUserVal.firebaseUid,
        role: 'user',
        accountStatus: 'active',
        displayName: 'Val Gamer'
      };

      const res = await request(app)
        .post('/api/support/tickets')
        .send({
          category: 'billing',
          subject: 'Payment double charged',
          message: 'I was charged twice for season pass.'
        });

      expect(res.status).toBe(201);

      // Persisted notification for admin
      const adminNotif = await Notification.findOne({
        recipient: adminUser._id,
        title: { $regex: /New Support Ticket/ }
      });
      expect(adminNotif).toBeDefined();

      // Socket emission to admin
      const adminEvent = emittedEvents.find(e => e.room === `user:${adminUser._id}`);
      expect(adminEvent).toBeDefined();
      expect(adminEvent.payload.ticketNumber).toBeDefined();
      expect(adminEvent.payload.ticketNumber).toMatch(/^TCK-/);
    });

    it('staff reply to ticket emits notification:new to ticket creator', async () => {
      // Create a ticket first
      const ticket = await SupportTicket.create({
        ticketNumber: 'TCK-20261023-9001',
        creator: activeUserVal._id,
        creatorEmail: activeUserVal.email,
        accountStatusAtCreation: 'active',
        category: 'general',
        subject: 'General inquiry',
        messages: [{
          senderRole: 'user',
          sender: activeUserVal._id,
          senderDisplayName: 'Val Gamer',
          text: 'Need assistance'
        }]
      });

      // Staff replies
      authState.currentUser = {
        _id: adminUser._id,
        uid: adminUser.firebaseUid,
        role: 'super_admin',
        accountStatus: 'active',
        displayName: 'Admin User'
      };

      const res = await request(app)
        .post(`/api/support/tickets/${ticket._id}/reply`)
        .send({ text: 'We have updated your account.' });

      expect(res.status).toBe(201);

      // Persisted notification for creator
      const creatorNotif = await Notification.findOne({
        recipient: activeUserVal._id,
        title: 'Reply to Ticket [TCK-20261023-9001]'
      });
      expect(creatorNotif).toBeDefined();

      // Socket emission delivered to creator's room
      const creatorEvent = emittedEvents.find(e => e.room === `user:${activeUserVal._id}`);
      expect(creatorEvent).toBeDefined();
      expect(creatorEvent.payload.ticketNumber).toBe('TCK-20261023-9001');
    });

    it('user reply to ticket emits notification:new to assigned staff', async () => {
      const ticket = await SupportTicket.create({
        ticketNumber: 'TCK-20261023-9002',
        creator: activeUserVal._id,
        creatorEmail: activeUserVal.email,
        accountStatusAtCreation: 'active',
        assignedStaff: adminUser._id,
        category: 'general',
        subject: 'General inquiry 2',
        messages: [{
          senderRole: 'user',
          sender: activeUserVal._id,
          senderDisplayName: 'Val Gamer',
          text: 'Initial message'
        }]
      });

      // User replies
      authState.currentUser = {
        _id: activeUserVal._id,
        uid: activeUserVal.firebaseUid,
        role: 'user',
        accountStatus: 'active',
        displayName: 'Val Gamer'
      };

      const res = await request(app)
        .post(`/api/support/tickets/${ticket._id}/reply`)
        .send({ text: 'Thank you for following up.' });

      expect(res.status).toBe(201);

      // Notification persisted for assigned staff
      const staffNotif = await Notification.findOne({
        recipient: adminUser._id,
        title: 'New User Reply [TCK-20261023-9002]'
      });
      expect(staffNotif).toBeDefined();

      // Socket event emitted to staff room
      const staffEvent = emittedEvents.find(e => e.room === `user:${adminUser._id}`);
      expect(staffEvent).toBeDefined();
      expect(staffEvent.payload.ticketNumber).toBe('TCK-20261023-9002');
    });

    it('updating ticket status to resolved emits notification:new to ticket creator', async () => {
      const ticket = await SupportTicket.create({
        ticketNumber: 'TCK-20261023-9003',
        creator: activeUserVal._id,
        creatorEmail: activeUserVal.email,
        accountStatusAtCreation: 'active',
        status: 'in_progress',
        category: 'general',
        subject: 'Bug report',
        messages: [{
          senderRole: 'user',
          sender: activeUserVal._id,
          senderDisplayName: 'Val Gamer',
          text: 'Bug'
        }]
      });

      // Admin resolves ticket
      authState.currentUser = {
        _id: adminUser._id,
        uid: adminUser.firebaseUid,
        role: 'super_admin',
        accountStatus: 'active'
      };

      const res = await request(app)
        .patch(`/api/support/admin/tickets/${ticket._id}`)
        .send({ status: 'resolved' });

      expect(res.status).toBe(200);

      const statusNotif = await Notification.findOne({
        recipient: activeUserVal._id,
        title: 'Ticket Status Updated [TCK-20261023-9003]'
      });
      expect(statusNotif).toBeDefined();

      const statusEvent = emittedEvents.find(e => e.room === `user:${activeUserVal._id}`);
      expect(statusEvent).toBeDefined();
      expect(statusEvent.payload.ticketNumber).toBe('TCK-20261023-9003');
    });
  });

  describe('5. Suspension Appeal Notification Delivery', () => {
    it('submitting appeal persists notification and emits to admin', async () => {
      authState.currentUser = {
        _id: suspendedUser._id,
        uid: suspendedUser.firebaseUid,
        role: 'user',
        accountStatus: 'suspended',
        displayName: 'Suspended Gamer'
      };

      const res = await request(app)
        .post('/api/support/appeal')
        .send({ message: 'I would like to appeal my suspension.' });

      expect(res.status).toBe(201);

      const appealNotif = await Notification.findOne({
        recipient: adminUser._id,
        title: 'New Appeal Submitted'
      });
      expect(appealNotif).toBeDefined();

      const appealEvent = emittedEvents.find(e => e.room === `user:${adminUser._id}` && e.payload?.title === 'New Appeal Submitted');
      expect(appealEvent).toBeDefined();
      expect(appealEvent.payload._id).toBe(appealNotif._id.toString());
    });
  });

  describe('6. REST Contracts & Read/Unread Status Preservation', () => {
    it('read count and mark-as-read endpoints remain functioning and unchanged', async () => {
      const notif = await Notification.create({
        recipient: activeUserVal._id,
        title: 'Test Read State',
        message: 'Unread notification',
        read: false
      });

      authState.currentUser = {
        _id: activeUserVal._id,
        uid: activeUserVal.firebaseUid,
        role: 'user',
        accountStatus: 'active'
      };

      // Check unread count
      const countRes = await request(app).get('/api/notifications/unread-count');
      expect(countRes.status).toBe(200);
      expect(countRes.body.count).toBe(1);

      // Mark as read
      const markRes = await request(app).patch(`/api/notifications/${notif._id}/read`);
      expect(markRes.status).toBe(200);
      expect(markRes.body.read).toBe(true);

      // Check unread count is 0
      const countRes2 = await request(app).get('/api/notifications/unread-count');
      expect(countRes2.body.count).toBe(0);
    });

    it('markAsRead persists update and emits notification:read to user room', async () => {
      const notif = await Notification.create({
        recipient: activeUserVal._id,
        title: 'Single Read Test',
        message: 'Unread',
        read: false
      });

      authState.currentUser = {
        _id: activeUserVal._id,
        uid: activeUserVal.firebaseUid,
        role: 'user',
        accountStatus: 'active'
      };

      emittedEvents = [];

      const res = await request(app).patch(`/api/notifications/${notif._id}/read`);
      expect(res.status).toBe(200);
      expect(res.body.read).toBe(true);

      const dbDoc = await Notification.findById(notif._id);
      expect(dbDoc.read).toBe(true);

      // Verify Socket.IO emission to user room
      expect(emittedEvents.length).toBe(1);
      expect(emittedEvents[0].room).toBe(`user:${activeUserVal._id}`);
      expect(emittedEvents[0].event).toBe('notification:read');
      expect(emittedEvents[0].payload._id).toBe(notif._id.toString());
      expect(emittedEvents[0].payload.read).toBe(true);
    });

    it('markAsRead does not emit or alter state when notification is owned by another user', async () => {
      const notif = await Notification.create({
        recipient: activeUserBrawl._id,
        title: 'Other User Notif',
        message: 'Unread',
        read: false
      });

      authState.currentUser = {
        _id: activeUserVal._id,
        uid: activeUserVal.firebaseUid,
        role: 'user',
        accountStatus: 'active'
      };

      emittedEvents = [];

      const res = await request(app).patch(`/api/notifications/${notif._id}/read`);
      expect(res.status).toBe(404);

      const dbDoc = await Notification.findById(notif._id);
      expect(dbDoc.read).toBe(false);
      expect(emittedEvents.length).toBe(0);
    });

    it('markAsRead: socket failure after persistence does not cause HTTP 500', async () => {
      const notif = await Notification.create({
        recipient: activeUserVal._id,
        title: 'Resilient Single Read',
        message: 'Unread',
        read: false
      });

      authState.currentUser = {
        _id: activeUserVal._id,
        uid: activeUserVal.firebaseUid,
        role: 'user',
        accountStatus: 'active'
      };

      vi.spyOn(socketConfig, 'getIO').mockReturnValue({
        to: () => ({
          emit: () => {
            throw new Error('Socket crash on read');
          }
        })
      });

      const res = await request(app).patch(`/api/notifications/${notif._id}/read`);
      expect(res.status).toBe(200);
      expect(res.body.read).toBe(true);

      const dbDoc = await Notification.findById(notif._id);
      expect(dbDoc.read).toBe(true);
    });

    it('markAllAsRead updates only notifications at or before server cutoff and emits notification:read_all', async () => {
      // Create past notifications
      const pastDate = new Date(Date.now() - 5000);
      const notif1 = await Notification.create({
        recipient: activeUserVal._id,
        title: 'Past 1',
        message: 'Msg',
        read: false,
        createdAt: pastDate
      });
      const notif2 = await Notification.create({
        recipient: activeUserVal._id,
        title: 'Past 2',
        message: 'Msg',
        read: false,
        createdAt: pastDate
      });
      // Another user's notification
      const otherNotif = await Notification.create({
        recipient: activeUserBrawl._id,
        title: 'Other Notif',
        message: 'Msg',
        read: false,
        createdAt: pastDate
      });

      authState.currentUser = {
        _id: activeUserVal._id,
        uid: activeUserVal.firebaseUid,
        role: 'user',
        accountStatus: 'active'
      };

      emittedEvents = [];

      const res = await request(app).patch('/api/notifications/read-all');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.readAt).toBeDefined();

      const cutoffTime = new Date(res.body.readAt);

      // Verify DB persistence
      const updated1 = await Notification.findById(notif1._id);
      const updated2 = await Notification.findById(notif2._id);
      const updatedOther = await Notification.findById(otherNotif._id);

      expect(updated1.read).toBe(true);
      expect(updated2.read).toBe(true);
      expect(updatedOther.read).toBe(false); // Other user's notification untouched

      // Verify Socket.IO emission to user room
      expect(emittedEvents.length).toBe(1);
      expect(emittedEvents[0].room).toBe(`user:${activeUserVal._id}`);
      expect(emittedEvents[0].event).toBe('notification:read_all');
      expect(emittedEvents[0].payload.readAt).toBe(res.body.readAt);

      // Concurrency check: create a notification AFTER the cutoff
      const futureNotif = await Notification.create({
        recipient: activeUserVal._id,
        title: 'Arrived After Cutoff',
        message: 'Msg',
        read: false,
        createdAt: new Date(cutoffTime.getTime() + 1000)
      });

      // Assert it remains unread
      const checkFuture = await Notification.findById(futureNotif._id);
      expect(checkFuture.read).toBe(false);
    });

    it('markAllAsRead: socket failure after persistence does not cause HTTP 500', async () => {
      await Notification.create({
        recipient: activeUserVal._id,
        title: 'Resilient Bulk Read',
        message: 'Unread',
        read: false
      });

      authState.currentUser = {
        _id: activeUserVal._id,
        uid: activeUserVal.firebaseUid,
        role: 'user',
        accountStatus: 'active'
      };

      vi.spyOn(socketConfig, 'getIO').mockReturnValue({
        to: () => ({
          emit: () => {
            throw new Error('Socket crash on read-all');
          }
        })
      });

      const res = await request(app).patch('/api/notifications/read-all');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const unreadCount = await Notification.countDocuments({ recipient: activeUserVal._id, read: false });
      expect(unreadCount).toBe(0);
    });

    it('suspended user: read events emit to official:<id> room per routing policy', async () => {
      const notif = await Notification.create({
        recipient: suspendedUser._id,
        title: 'Official Suspension Notice',
        message: 'Please appeal.',
        read: false
      });

      authState.currentUser = {
        _id: suspendedUser._id,
        uid: suspendedUser.firebaseUid,
        role: 'user',
        accountStatus: 'suspended'
      };

      emittedEvents = [];

      const res = await request(app).patch(`/api/notifications/${notif._id}/read`);
      expect(res.status).toBe(200);
      expect(res.body.read).toBe(true);

      // Emitted to official:<suspendedId>
      expect(emittedEvents.length).toBe(1);
      expect(emittedEvents[0].room).toBe(`official:${suspendedUser._id}`);
      expect(emittedEvents[0].event).toBe('notification:read');
    });
  });

  describe('7. Friend Request Notification Delivery (R-03)', () => {
    beforeEach(() => {
      connectionRequestRateLimiter.reset();
      authState.currentUser = {
        _id: activeUserVal._id,
        uid: activeUserVal.firebaseUid,
        role: 'user',
        accountStatus: 'active'
      };
    });

    it('1. Successful request creates exactly one recipient notification with canonical format', async () => {
      const res = await request(app)
        .post(`/api/connections/request/${activeUserBrawl._id}`);

      expect(res.status).toBe(201);
      expect(res.body.message).toBe('Connection request sent');
      expect(res.body.connection).toBeDefined();

      const notifs = await Notification.find({ recipient: activeUserBrawl._id });
      expect(notifs.length).toBe(1);
      expect(notifs[0].title).toBe('New Connection Request');
      expect(notifs[0].message).toContain(activeUserVal.displayName);
      expect(notifs[0].read).toBe(false);
    });

    it('2. Successful request invokes existing notification delivery service (notification:new on user:<recipientId>)', async () => {
      const res = await request(app)
        .post(`/api/connections/request/${activeUserBrawl._id}`);

      expect(res.status).toBe(201);
      expect(emittedEvents.length).toBe(1);
      expect(emittedEvents[0].room).toBe(`user:${activeUserBrawl._id}`);
      expect(emittedEvents[0].event).toBe('notification:new');
      expect(emittedEvents[0].payload.title).toBe('New Connection Request');
      expect(emittedEvents[0].payload.recipient).toBeUndefined(); // canonical payload strips recipient
    });

    it('3. Duplicate or invalid requests do not create duplicate notifications', async () => {
      // First request succeeds
      const res1 = await request(app)
        .post(`/api/connections/request/${activeUserBrawl._id}`);
      expect(res1.status).toBe(201);
      expect(emittedEvents.length).toBe(1);

      emittedEvents = [];

      // Duplicate request fails with 400
      const res2 = await request(app)
        .post(`/api/connections/request/${activeUserBrawl._id}`);
      expect(res2.status).toBe(400);

      // Invalid user ID fails with 400
      const res3 = await request(app)
        .post('/api/connections/request/invalid-id');
      expect(res3.status).toBe(400);

      // Connecting to self fails with 400
      const res4 = await request(app)
        .post(`/api/connections/request/${activeUserVal._id}`);
      expect(res4.status).toBe(400);

      // Total notifications in DB remains 1
      const notifs = await Notification.find({ recipient: activeUserBrawl._id });
      expect(notifs.length).toBe(1);
      expect(emittedEvents.length).toBe(0);
    });

    it('4. Persistence failure of Connection does not emit a notification or create notification document', async () => {
      vi.spyOn(Connection.prototype, 'save').mockRejectedValueOnce(new Error('Connection save failed'));

      const res = await request(app)
        .post(`/api/connections/request/${activeUserBrawl._id}`);

      expect(res.status).toBe(500);

      const notifs = await Notification.find({});
      expect(notifs.length).toBe(0);
      expect(emittedEvents.length).toBe(0);
    });

    it('5. Notification creation or socket failure does not turn successfully saved request into HTTP 500', async () => {
      // Mock Notification.create to throw
      vi.spyOn(Notification, 'create').mockRejectedValueOnce(new Error('Notification DB failure'));

      const res = await request(app)
        .post(`/api/connections/request/${activeUserBrawl._id}`);

      expect(res.status).toBe(201);
      expect(res.body.message).toBe('Connection request sent');
      expect(res.body.connection).toBeDefined();

      // Connection is saved in DB
      const conn = await Connection.findOne({ requester: activeUserVal._id, recipient: activeUserBrawl._id });
      expect(conn).toBeDefined();
    });

    it('6. Does not deliver friend request notification to official:<id> when recipient is suspended', async () => {
      const res = await request(app)
        .post(`/api/connections/request/${suspendedUser._id}`);

      expect(res.status).toBe(201);

      // Notification document is created for recipient
      const notifs = await Notification.find({ recipient: suspendedUser._id });
      expect(notifs.length).toBe(1);

      // BUT no Socket.IO emission to official:<suspendedId>
      const officialEvent = emittedEvents.find(e => e.room === `official:${suspendedUser._id}`);
      expect(officialEvent).toBeUndefined();
    });
  });

  describe('8. Admin Broadcast Idempotency (R-06)', () => {
    let secondAdmin;

    beforeEach(async () => {
      authState.currentUser = {
        _id: adminUser._id,
        uid: adminUser.firebaseUid,
        role: 'super_admin',
        accountStatus: 'active'
      };

      // Ensure indexes are synced on BroadcastNotification
      await BroadcastNotification.syncIndexes();

      // Create a second admin to verify namespace scoping
      secondAdmin = await UserProfile.create({
        firebaseUid: 'uid-admin-2',
        email: 'admin2@zync.test',
        displayName: 'Admin User Two',
        role: 'super_admin',
        accountStatus: 'active',
        games: []
      });
    });

    it('1. A valid key creates a broadcast and its intended notifications', async () => {
      const res = await request(app)
        .post('/api/admin/notifications')
        .send({
          audienceType: 'all',
          title: 'Update 1.0',
          message: 'Welcome to the new release.',
          idempotencyKey: 'idemp-valid-01'
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.recipientCount).toBe(4); // 2 admins + 2 active gamers
      expect(res.body.broadcastId).toBeDefined();

      // Canonical record in BroadcastNotification has idempotencyKey
      const broadcast = await BroadcastNotification.findById(res.body.broadcastId);
      expect(broadcast).toBeDefined();
      expect(broadcast.idempotencyKey).toBe('idemp-valid-01');
      expect(broadcast.title).toBe('Update 1.0');

      // Intended recipient notifications created in Notification collection
      const notifications = await Notification.find({ broadcastId: broadcast._id });
      expect(notifications.length).toBe(4);

      // Sockets emitted to active users
      expect(emittedEvents.length).toBe(4);
    });

    it('2. Repeating the same key with the same logical request returns the existing result without creating duplicate records', async () => {
      const payload = {
        audienceType: 'all',
        title: 'Network Retry Test',
        message: 'Checking for duplicate suppression.',
        idempotencyKey: 'idemp-retry-01'
      };

      // First request
      const res1 = await request(app)
        .post('/api/admin/notifications')
        .send(payload);
      expect(res1.status).toBe(201);
      const originalBroadcastId = res1.body.broadcastId;

      // Second request with exact same key and parameters
      const res2 = await request(app)
        .post('/api/admin/notifications')
        .send(payload);

      expect(res2.status).toBe(200);
      expect(res2.body.success).toBe(true);
      expect(res2.body.broadcastId).toBe(originalBroadcastId);
      expect(res2.body.idempotent).toBe(true);
      expect(res2.body.recipientCount).toBe(res1.body.recipientCount);

      // Total records in database must NOT double
      const totalBroadcasts = await BroadcastNotification.countDocuments({ idempotencyKey: 'idemp-retry-01' });
      expect(totalBroadcasts).toBe(1);

      const totalNotifications = await Notification.countDocuments({ broadcastId: originalBroadcastId });
      expect(totalNotifications).toBe(res1.body.recipientCount);
    });

    it('3. Repeating the same key does not repeat socket fan-out', async () => {
      const payload = {
        audienceType: 'game',
        targetGame: 'Valorant',
        title: 'Valorant Tournament',
        message: 'Starts at 7 PM UTC.',
        idempotencyKey: 'idemp-fanout-01'
      };

      // First submission emits to active Valorant gamers
      const res1 = await request(app)
        .post('/api/admin/notifications')
        .send(payload);
      expect(res1.status).toBe(201);
      expect(emittedEvents.length).toBe(1);

      // Clear emitted events log to monitor second submission
      emittedEvents = [];

      // Second submission repeats request
      const res2 = await request(app)
        .post('/api/admin/notifications')
        .send(payload);
      expect(res2.status).toBe(200);

      // Zero additional socket emissions
      expect(emittedEvents.length).toBe(0);
    });

    it('4. Concurrent requests with the same key produce one canonical broadcast and at most one set of side effects', async () => {
      const payload = {
        audienceType: 'all',
        title: 'Concurrent Race Test',
        message: 'Stress testing idempotency under simultaneous requests.',
        idempotencyKey: 'idemp-concurrent-01'
      };

      // Fire 3 simultaneous requests with the exact same idempotencyKey
      const [resA, resB, resC] = await Promise.all([
        request(app).post('/api/admin/notifications').send(payload),
        request(app).post('/api/admin/notifications').send(payload),
        request(app).post('/api/admin/notifications').send(payload)
      ]);

      // All responses should succeed (one with 201, others with 200)
      const statuses = [resA.status, resB.status, resC.status];
      expect(statuses).toContain(201);
      statuses.forEach(s => expect([200, 201]).toContain(s));

      // All must refer to the exact same broadcastId
      const bIdA = resA.body.broadcastId;
      const bIdB = resB.body.broadcastId;
      const bIdC = resC.body.broadcastId;
      expect(bIdB).toBe(bIdA);
      expect(bIdC).toBe(bIdA);

      // Exactly 1 BroadcastNotification record created
      const bCount = await BroadcastNotification.countDocuments({ idempotencyKey: 'idemp-concurrent-01' });
      expect(bCount).toBe(1);

      // Exactly 1 set of recipient Notification records created (4 active users)
      const nCount = await Notification.countDocuments({ broadcastId: bIdA });
      expect(nCount).toBe(4);

      // Sockets should be delivered only for the canonical set of notifications (4 total)
      expect(emittedEvents.length).toBe(4);
    });

    it('5. The database unique constraint prevents duplicate records even when requests race', async () => {
      // Direct database-level test of the unique compound index
      await BroadcastNotification.create({
        sender: adminUser._id,
        audienceType: 'all',
        title: 'DB Constraint Test',
        message: 'First insert',
        recipientCount: 1,
        idempotencyKey: 'db-unique-key-01'
      });

      // Second insert with same sender and idempotencyKey must throw code 11000
      let errorThrown = null;
      try {
        await BroadcastNotification.create({
          sender: adminUser._id,
          audienceType: 'all',
          title: 'DB Constraint Test',
          message: 'Second insert',
          recipientCount: 1,
          idempotencyKey: 'db-unique-key-01'
        });
      } catch (err) {
        errorThrown = err;
      }

      expect(errorThrown).toBeDefined();
      expect(errorThrown.code).toBe(11000);
    });

    it('6. MongoDB duplicate-key error 11000 is handled safely and does not become an unhandled server error', async () => {
      const payload = {
        audienceType: 'all',
        title: 'E11000 Safe Handling',
        message: 'Testing error 11000 recovery.',
        idempotencyKey: 'idemp-11000-safe'
      };

      // Create pre-existing broadcast
      const existingBroadcast = await BroadcastNotification.create({
        sender: adminUser._id,
        audienceType: 'all',
        title: payload.title,
        message: payload.message,
        recipientCount: 4,
        idempotencyKey: payload.idempotencyKey
      });

      // Spy on BroadcastNotification.create to simulate a race condition throwing 11000
      vi.spyOn(BroadcastNotification, 'create').mockRejectedValueOnce(
        Object.assign(new Error('E11000 duplicate key error collection'), { code: 11000 })
      );

      const res = await request(app)
        .post('/api/admin/notifications')
        .send(payload);

      // Handled cleanly as HTTP 200 without leaking an internal server error 500
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.broadcastId).toBe(existingBroadcast._id.toString());
      expect(res.body.idempotent).toBe(true);
    });

    it('7. Reusing a key with different request parameters returns the documented conflict response without triggering new side effects', async () => {
      const originalPayload = {
        audienceType: 'all',
        title: 'Initial Announcement',
        message: 'Original text.',
        idempotencyKey: 'idemp-conflict-test'
      };

      const res1 = await request(app)
        .post('/api/admin/notifications')
        .send(originalPayload);
      expect(res1.status).toBe(201);

      emittedEvents = [];

      // Reusing the same key with altered title
      const conflictPayload1 = {
        audienceType: 'all',
        title: 'Altered Announcement Title',
        message: 'Original text.',
        idempotencyKey: 'idemp-conflict-test'
      };

      const res2 = await request(app)
        .post('/api/admin/notifications')
        .send(conflictPayload1);

      expect(res2.status).toBe(409);
      expect(res2.body.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
      expect(res2.body.message).toContain('different parameters');
      expect(emittedEvents.length).toBe(0);

      // Reusing the same key with altered audienceType
      const conflictPayload2 = {
        audienceType: 'game',
        targetGame: 'Valorant',
        title: 'Initial Announcement',
        message: 'Original text.',
        idempotencyKey: 'idemp-conflict-test'
      };

      const res3 = await request(app)
        .post('/api/admin/notifications')
        .send(conflictPayload2);

      expect(res3.status).toBe(409);
      expect(res3.body.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
      expect(emittedEvents.length).toBe(0);

      // Verify no records created for altered content
      const alteredNotifs = await Notification.find({ title: 'Altered Announcement Title' });
      expect(alteredNotifs.length).toBe(0);
    });

    it('8. Different keys allow two legitimate broadcasts with identical content', async () => {
      const payload1 = {
        audienceType: 'all',
        title: 'Routine Server Restart',
        message: 'Servers will restart at 3 AM.',
        idempotencyKey: 'routine-restart-week-1'
      };
      const payload2 = {
        audienceType: 'all',
        title: 'Routine Server Restart',
        message: 'Servers will restart at 3 AM.',
        idempotencyKey: 'routine-restart-week-2'
      };

      const res1 = await request(app)
        .post('/api/admin/notifications')
        .send(payload1);
      expect(res1.status).toBe(201);

      const res2 = await request(app)
        .post('/api/admin/notifications')
        .send(payload2);
      expect(res2.status).toBe(201);

      expect(res1.body.broadcastId).not.toBe(res2.body.broadcastId);

      const count = await BroadcastNotification.countDocuments({ title: 'Routine Server Restart' });
      expect(count).toBe(2);
    });

    it('9. Different authenticated admins do not accidentally collide when using the same key, according to the chosen scope', async () => {
      const sharedKey = 'common-default-key-uuid';

      // Admin 1 posts with sharedKey
      authState.currentUser = {
        _id: adminUser._id,
        uid: adminUser.firebaseUid,
        role: 'super_admin',
        accountStatus: 'active'
      };

      const res1 = await request(app)
        .post('/api/admin/notifications')
        .send({
          audienceType: 'all',
          title: 'Admin 1 Notice',
          message: 'From first administrator.',
          idempotencyKey: sharedKey
        });
      expect(res1.status).toBe(201);

      // Admin 2 posts with the same sharedKey
      authState.currentUser = {
        _id: secondAdmin._id,
        uid: secondAdmin.firebaseUid,
        role: 'super_admin',
        accountStatus: 'active'
      };

      const res2 = await request(app)
        .post('/api/admin/notifications')
        .send({
          audienceType: 'all',
          title: 'Admin 2 Notice',
          message: 'From second administrator.',
          idempotencyKey: sharedKey
        });
      expect(res2.status).toBe(201);

      // Both broadcasts exist independently in database
      const b1 = await BroadcastNotification.findById(res1.body.broadcastId);
      const b2 = await BroadcastNotification.findById(res2.body.broadcastId);
      expect(b1.sender.toString()).toBe(adminUser._id.toString());
      expect(b2.sender.toString()).toBe(secondAdmin._id.toString());
      expect(b1.idempotencyKey).toBe(sharedKey);
      expect(b2.idempotencyKey).toBe(sharedKey);
    });

    it('10. Missing, malformed, or oversized keys are rejected according to the documented contract', async () => {
      // Empty string key in body -> 400
      const res1 = await request(app)
        .post('/api/admin/notifications')
        .send({
          audienceType: 'all',
          title: 'Title',
          message: 'Message',
          idempotencyKey: '   '
        });
      expect(res1.status).toBe(400);
      expect(res1.body.message).toContain('cannot be empty');

      // Empty string key in header -> 400
      const res2 = await request(app)
        .post('/api/admin/notifications')
        .set('Idempotency-Key', '')
        .send({
          audienceType: 'all',
          title: 'Title',
          message: 'Message'
        });
      expect(res2.status).toBe(400);
      expect(res2.body.message).toContain('cannot be empty');

      // Non-string key -> 400
      const res3 = await request(app)
        .post('/api/admin/notifications')
        .send({
          audienceType: 'all',
          title: 'Title',
          message: 'Message',
          idempotencyKey: 123456
        });
      expect(res3.status).toBe(400);
      expect(res3.body.message).toContain('must be a string');

      // Oversized key (> 128 characters) -> 400
      const res4 = await request(app)
        .post('/api/admin/notifications')
        .send({
          audienceType: 'all',
          title: 'Title',
          message: 'Message',
          idempotencyKey: 'k'.repeat(129)
        });
      expect(res4.status).toBe(400);
      expect(res4.body.message).toContain('exceeds maximum length');

      // Legacy/non-idempotent request without key continues to succeed
      const res5 = await request(app)
        .post('/api/admin/notifications')
        .send({
          audienceType: 'all',
          title: 'Legacy Title',
          message: 'Legacy Message'
        });
      expect(res5.status).toBe(201);
    });

    it('11. Failed persistence does not trigger notification creation or socket delivery', async () => {
      vi.spyOn(BroadcastNotification, 'create').mockRejectedValueOnce(new Error('Fatal DB failure'));

      const res = await request(app)
        .post('/api/admin/notifications')
        .send({
          audienceType: 'all',
          title: 'Should Never Save',
          message: 'Should never emit.',
          idempotencyKey: 'fail-persist-01'
        });

      expect(res.status).toBe(500);

      // No notifications created
      const notifs = await Notification.find({ title: 'Should Never Save' });
      expect(notifs.length).toBe(0);

      // No sockets emitted
      expect(emittedEvents.length).toBe(0);
    });

    it('12. A duplicate retry after a partial side-effect failure does not blindly duplicate all previously completed side effects', async () => {
      const payload = {
        audienceType: 'all',
        title: 'Partial Recovery Test',
        message: 'Recovering safely without duplicate records.',
        idempotencyKey: 'partial-recovery-01'
      };

      // Create broadcast and pre-populate notifications for 2 of the 4 eligible recipients
      const broadcast = await BroadcastNotification.create({
        sender: adminUser._id,
        audienceType: 'all',
        title: payload.title,
        message: payload.message,
        recipientCount: 4,
        idempotencyKey: payload.idempotencyKey
      });

      // Insert notifications for adminUser and activeUserVal only
      await Notification.create({
        recipient: adminUser._id,
        broadcastId: broadcast._id,
        title: payload.title,
        message: payload.message,
        read: false
      });
      await Notification.create({
        recipient: activeUserVal._id,
        broadcastId: broadcast._id,
        title: payload.title,
        message: payload.message,
        read: false
      });

      // Now client retries with the same idempotency key
      const res = await request(app)
        .post('/api/admin/notifications')
        .send(payload);

      expect(res.status).toBe(200);

      // Total notifications for this broadcast should equal recipientCount (4), with NO duplicates for adminUser or activeUserVal
      const notifsForAdmin = await Notification.find({ broadcastId: broadcast._id, recipient: adminUser._id });
      expect(notifsForAdmin.length).toBe(1);

      const notifsForVal = await Notification.find({ broadcastId: broadcast._id, recipient: activeUserVal._id });
      expect(notifsForVal.length).toBe(1);

      const totalNotifs = await Notification.find({ broadcastId: broadcast._id });
      expect(totalNotifs.length).toBe(4);
    });

    it('13. Supports Idempotency-Key header as alternative to request body field', async () => {
      const res1 = await request(app)
        .post('/api/admin/notifications')
        .set('Idempotency-Key', 'header-key-01')
        .send({
          audienceType: 'all',
          title: 'Header Key Test',
          message: 'Passed via HTTP header.'
        });

      expect(res1.status).toBe(201);
      const broadcast = await BroadcastNotification.findById(res1.body.broadcastId);
      expect(broadcast.idempotencyKey).toBe('header-key-01');

      // Duplicate via header returns existing record
      const res2 = await request(app)
        .post('/api/admin/notifications')
        .set('Idempotency-Key', 'header-key-01')
        .send({
          audienceType: 'all',
          title: 'Header Key Test',
          message: 'Passed via HTTP header.'
        });

      expect(res2.status).toBe(200);
      expect(res2.body.broadcastId).toBe(res1.body.broadcastId);
      expect(res2.body.idempotent).toBe(true);
    });
  });

  describe('9. Post-Audit Remediation F-01: Concurrent Broadcast Notification Deduplication', () => {
    beforeEach(async () => {
      authState.currentUser = {
        _id: adminUser._id,
        uid: adminUser.firebaseUid,
        role: 'super_admin',
        accountStatus: 'active'
      };

      await Notification.syncIndexes();
      await BroadcastNotification.syncIndexes();
    });

    it('1. Database unique constraint prevents duplicate (broadcastId, recipient) notifications', async () => {
      const broadcastId = new mongoose.Types.ObjectId();
      const recipientId = activeUserVal._id;

      // First insert succeeds
      await Notification.create({
        recipient: recipientId,
        broadcastId,
        title: 'Unique Test',
        message: 'First'
      });

      // Second insert with exact same broadcastId and recipient must throw code 11000
      let errorThrown = null;
      try {
        await Notification.create({
          recipient: recipientId,
          broadcastId,
          title: 'Unique Test',
          message: 'Second'
        });
      } catch (err) {
        errorThrown = err;
      }

      expect(errorThrown).toBeDefined();
      expect(errorThrown.code).toBe(11000);
    });

    it('2. Non-broadcast notifications without a broadcastId retain existing behavior without colliding', async () => {
      const recipientId = activeUserVal._id;

      // Multiple non-broadcast notifications for the same recipient
      const n1 = await Notification.create({
        recipient: recipientId,
        title: 'Direct Alert 1',
        message: 'Direct msg 1'
      });

      const n2 = await Notification.create({
        recipient: recipientId,
        title: 'Direct Alert 2',
        message: 'Direct msg 2'
      });

      expect(n1._id).toBeDefined();
      expect(n2._id).toBeDefined();
      expect(n1._id.toString()).not.toBe(n2._id.toString());

      const count = await Notification.countDocuments({ recipient: recipientId });
      expect(count).toBe(2);
    });

    it('3. Two concurrent recovery requests using the same idempotency key cannot create duplicate notification records for the same recipient', async () => {
      const idempotencyKey = 'f01-concurrent-recovery-01';

      // Simulate a previously created broadcast where notification creation had not completed (0 notifications inserted)
      const broadcast = await BroadcastNotification.create({
        sender: adminUser._id,
        audienceType: 'all',
        title: 'Recovery Broadcast',
        message: 'Recovering safely',
        recipientCount: 3, // adminUser + activeUserVal + activeUserBrawl
        idempotencyKey
      });

      const payload = {
        audienceType: 'all',
        title: 'Recovery Broadcast',
        message: 'Recovering safely',
        idempotencyKey
      };

      // Two concurrent recovery requests race to recover the unfulfilled broadcast
      const [res1, res2] = await Promise.all([
        request(app).post('/api/admin/notifications').send(payload),
        request(app).post('/api/admin/notifications').send(payload)
      ]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res1.body.broadcastId).toBe(broadcast._id.toString());
      expect(res2.body.broadcastId).toBe(broadcast._id.toString());

      // Exactly 3 notifications in DB for this broadcast (1 for each active user, 0 duplicates)
      const allNotifs = await Notification.find({ broadcastId: broadcast._id });
      expect(allNotifs.length).toBe(3);

      const recipientIds = allNotifs.map(n => n.recipient.toString());
      const uniqueRecipientIds = new Set(recipientIds);
      expect(uniqueRecipientIds.size).toBe(3);
    });

    it('4. Concurrent retries that encounter MongoDB error 11000 reconcile safely against canonical persisted records', async () => {
      const idempotencyKey = 'f01-error11000-reconcile';

      const broadcast = await BroadcastNotification.create({
        sender: adminUser._id,
        audienceType: 'all',
        title: 'Error 11000 Reconcile Test',
        message: 'Testing graceful recovery on bulk write error',
        recipientCount: 3,
        idempotencyKey
      });

      // Pre-insert notifications for all recipients
      await Notification.create({
        recipient: adminUser._id,
        broadcastId: broadcast._id,
        title: broadcast.title,
        message: broadcast.message
      });
      await Notification.create({
        recipient: activeUserVal._id,
        broadcastId: broadcast._id,
        title: broadcast.title,
        message: broadcast.message
      });
      await Notification.create({
        recipient: activeUserBrawl._id,
        broadcastId: broadcast._id,
        title: broadcast.title,
        message: broadcast.message
      });

      // Retry request finds all recipients accounted for and immediately reconciles
      const res = await request(app)
        .post('/api/admin/notifications')
        .send({
          audienceType: 'all',
          title: broadcast.title,
          message: broadcast.message,
          idempotencyKey
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.idempotent).toBe(true);
      expect(res.body.recipientCount).toBe(3);

      const count = await Notification.countDocuments({ broadcastId: broadcast._id });
      expect(count).toBe(3);
    });

    it('5. Concurrent recovery cannot initiate duplicate socket fan-out for the same logical broadcast', async () => {
      const idempotencyKey = 'f01-socket-fanout-01';

      // Broadcast exists, 0 notifications exist (partial failure recovery scenario)
      await BroadcastNotification.create({
        sender: adminUser._id,
        audienceType: 'game',
        targetGame: 'Valorant',
        title: 'Valorant Fanout Recovery',
        message: 'Emits exactly once',
        recipientCount: 1, // activeUserVal only
        idempotencyKey
      });

      emittedEvents = [];

      const payload = {
        audienceType: 'game',
        targetGame: 'Valorant',
        title: 'Valorant Fanout Recovery',
        message: 'Emits exactly once',
        idempotencyKey
      };

      // Two concurrent recovery requests
      const [resA, resB] = await Promise.all([
        request(app).post('/api/admin/notifications').send(payload),
        request(app).post('/api/admin/notifications').send(payload)
      ]);

      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);

      // Exactly 1 socket emission to user:activeUserVal across BOTH requests (not 2)
      expect(emittedEvents.length).toBe(1);
      expect(emittedEvents[0].room).toBe(`user:${activeUserVal._id}`);
    });

    it('6. Duplicate-key error from an unrelated constraint is not incorrectly treated as successful recovery', async () => {
      const idempotencyKey = 'f01-unrelated-error-test';

      await BroadcastNotification.create({
        sender: adminUser._id,
        audienceType: 'all',
        title: 'Unrelated Error Test',
        message: 'Should fail with 500',
        recipientCount: 3,
        idempotencyKey
      });

      // Simulate a duplicate key error on an unrelated index (e.g. email_1)
      const unrelatedDupError = Object.assign(new Error('E11000 duplicate key error collection: zync.users index: email_1 dup key'), {
        code: 11000,
        keyPattern: { email: 1 }
      });
      vi.spyOn(Notification, 'insertMany').mockRejectedValueOnce(unrelatedDupError);

      const res = await request(app)
        .post('/api/admin/notifications')
        .send({
          audienceType: 'all',
          title: 'Unrelated Error Test',
          message: 'Should fail with 500',
          idempotencyKey
        });

      // Must NOT be treated as successful recovery; returns 500
      expect(res.status).toBe(500);
      expect(res.body.message).toBe('Internal server error');
    });

    it('7. Genuine database errors during recovery are surfaced according to existing REST conventions', async () => {
      const idempotencyKey = 'f01-genuine-error-test';

      await BroadcastNotification.create({
        sender: adminUser._id,
        audienceType: 'all',
        title: 'Genuine DB Error Test',
        message: 'Should fail with 500',
        recipientCount: 3,
        idempotencyKey
      });

      vi.spyOn(Notification, 'insertMany').mockRejectedValueOnce(new Error('MongoNetworkTimeoutException'));

      const res = await request(app)
        .post('/api/admin/notifications')
        .send({
          audienceType: 'all',
          title: 'Genuine DB Error Test',
          message: 'Should fail with 500',
          idempotencyKey
        });

      expect(res.status).toBe(500);
      expect(res.body.message).toBe('Internal server error');
    });
  });
});

