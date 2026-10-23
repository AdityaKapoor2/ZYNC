import mongoose from 'mongoose';
import crypto from 'crypto';
import UserProfile from '../models/UserProfile.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import Notification from '../models/Notification.js';
import ModerationAction from '../models/ModerationAction.js';
import SupportTicket from '../models/SupportTicket.js';
import { getIO } from '../config/socket.js';
import { deliverNotification } from '../services/notificationService.js';

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Legacy appeal endpoint — preserved for backwards compatibility and tests
export const submitAppeal = async (req, res) => {
  try {
    const { message, clientMessageId } = req.body;
    const { uid } = req.user;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ message: 'Message cannot be empty' });
    }

    if (message.length > 2000) {
      return res.status(400).json({ message: 'Message exceeds maximum length' });
    }

    const currentUser = await UserProfile.findOne({ firebaseUid: uid });
    if (!currentUser) return res.status(404).json({ message: 'Profile not found' });

    // ONLY suspended users can use the appeal endpoint
    if (currentUser.accountStatus !== 'suspended') {
      return res.status(403).json({ message: 'Only suspended users can submit appeals' });
    }

    // Find a Super Admin to assign the conversation to
    const adminUser = await UserProfile.findOne({ role: 'super_admin' });
    if (!adminUser) {
      return res.status(500).json({ message: 'No moderation admin available to receive appeal' });
    }

    // Check if moderation conversation already exists between these two
    let conversation = await Conversation.findOne({
      participants: { $all: [currentUser._id, adminUser._id], $size: 2 },
      isModeration: true
    });

    if (!conversation) {
      conversation = new Conversation({
        participants: [currentUser._id, adminUser._id],
        isModeration: true
      });
      await conversation.save();
    }

    // Idempotency: validate client-supplied key or generate server-originated UUID v4
    let cleanClientMessageId = null;
    if (clientMessageId !== undefined) {
      if (typeof clientMessageId !== 'string' || !UUID_V4_REGEX.test(clientMessageId.trim())) {
        return res.status(400).json({ message: 'Invalid clientMessageId: must be a valid UUID v4' });
      }
      cleanClientMessageId = clientMessageId.trim();

      const existingMessage = await Message.findOne({
        conversationId: conversation._id,
        clientMessageId: cleanClientMessageId
      });

      if (existingMessage) {
        if (existingMessage.sender.toString() !== currentUser._id.toString()) {
          return res.status(409).json({ message: 'Conflict: clientMessageId has already been used by another sender' });
        }
        if (existingMessage.text !== message.trim()) {
          return res.status(409).json({ message: 'Conflict: clientMessageId cannot be reused with different message content' });
        }
        return res.status(200).json({ message: 'Appeal sent', conversationId: conversation._id, adminId: adminUser._id });
      }
    } else {
      cleanClientMessageId = crypto.randomUUID();
    }

    // Transactional sequence allocation and persistence
    const session = await mongoose.startSession();
    let committedMessage = null;
    let committedNotification = null;
    let duplicateResolved = null;

    try {
      await session.withTransaction(async () => {
        const concurrentMsg = await Message.findOne({
          conversationId: conversation._id,
          clientMessageId: cleanClientMessageId
        }).session(session);

        if (concurrentMsg) {
          duplicateResolved = concurrentMsg;
          return;
        }

        const updatedConv = await Conversation.findOneAndUpdate(
          { _id: conversation._id },
          { $inc: { lastSeq: 1 } },
          { session, returnDocument: 'after' }
        );

        if (!updatedConv) {
          throw new Error('CONVERSATION_NOT_FOUND');
        }

        const allocatedSeq = updatedConv.lastSeq;

        const newMsg = new Message({
          conversationId: conversation._id,
          sender: currentUser._id,
          senderRole: 'user',
          senderDisplayName: currentUser.displayName || 'Suspended Player',
          text: message.trim(),
          seq: allocatedSeq,
          clientMessageId: cleanClientMessageId
        });

        await newMsg.save({ session });

        const existingReadState = Array.isArray(updatedConv.readState) ? updatedConv.readState : [];
        let userFound = false;
        let adminFound = false;

        const nextReadState = existingReadState.map(entry => {
          if (entry.user && entry.user.toString() === currentUser._id.toString()) {
            userFound = true;
            return { user: entry.user, lastReadSeq: allocatedSeq };
          }
          if (entry.user && entry.user.toString() === adminUser._id.toString()) {
            adminFound = true;
            return entry;
          }
          return entry;
        });

        if (!userFound) {
          nextReadState.push({ user: currentUser._id, lastReadSeq: allocatedSeq });
        }
        if (!adminFound) {
          nextReadState.push({ user: adminUser._id, lastReadSeq: Math.max(0, allocatedSeq - 1) });
        }

        await Conversation.updateOne(
          { _id: conversation._id },
          {
            $set: {
              lastMessage: newMsg._id,
              lastMessageAt: newMsg.createdAt,
              readState: nextReadState
            }
          },
          { session }
        );

        const notification = new Notification({
          recipient: adminUser._id,
          title: 'New Appeal Submitted',
          message: `User ${currentUser.displayName || currentUser.email} has submitted a suspension appeal.`
        });
        await notification.save({ session });
        committedNotification = notification;

        committedMessage = newMsg;
      });
    } catch (txErr) {
      if (txErr.code === 11000 || (txErr.message && txErr.message.includes('E11000'))) {
        const raceMsg = await Message.findOne({
          conversationId: conversation._id,
          clientMessageId: cleanClientMessageId
        });
        if (raceMsg) {
          duplicateResolved = raceMsg;
        } else {
          throw txErr;
        }
      } else {
        throw txErr;
      }
    } finally {
      await session.endSession();
    }

    if (duplicateResolved) {
      if (duplicateResolved.sender.toString() !== currentUser._id.toString()) {
        return res.status(409).json({ message: 'Conflict: clientMessageId has already been used by another sender' });
      }
      if (duplicateResolved.text !== message.trim()) {
        return res.status(409).json({ message: 'Conflict: clientMessageId cannot be reused with different message content' });
      }
      return res.status(200).json({ message: 'Appeal sent', conversationId: conversation._id, adminId: adminUser._id });
    }

    if (!committedMessage) {
      return res.status(500).json({ message: 'Failed to commit appeal message' });
    }

    // Post-commit realtime emission
    const io = getIO();
    if (io) {
      const targetRoom = `official:${adminUser._id}`;
      const senderRoom = `official:${currentUser._id}`;
      const payload = committedMessage.toObject ? committedMessage.toObject() : committedMessage;
      io.to(targetRoom).to(senderRoom).emit('chat:message', payload);
    }

    if (committedNotification) {
      deliverNotification(committedNotification, {
        recipientId: adminUser._id,
        accountStatus: adminUser.accountStatus || 'active'
      });
    }

    return res.status(201).json({ message: 'Appeal sent', conversationId: conversation._id, adminId: adminUser._id });
  } catch (error) {
    console.error('Error submitting appeal:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// ==========================================
// DEDICATED SUPPORT TICKET CONTROLLERS
// ==========================================

// Valid categories
const VALID_CATEGORIES = [
  'account_access',
  'suspension_appeal',
  'billing',
  'bug_report',
  'harassment_inquiry',
  'general'
];

/**
 * POST /api/support/tickets
 * Available to both active and suspended users.
 */
export const createTicket = async (req, res) => {
  try {
    const { category, subject, message } = req.body;
    const { uid } = req.user;

    const currentUser = await UserProfile.findOne({ firebaseUid: uid });
    if (!currentUser) return res.status(404).json({ message: 'User profile not found' });

    if (!category || !VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ 
        message: `Invalid or missing category. Must be one of: ${VALID_CATEGORIES.join(', ')}` 
      });
    }

    // Suspended users can only submit suspension_appeal or account_access
    if (currentUser.accountStatus === 'suspended' && !['suspension_appeal', 'account_access'].includes(category)) {
      return res.status(403).json({
        message: 'Suspended users may only submit suspension appeals or account access tickets'
      });
    }

    if (!subject || subject.trim().length === 0) {
      return res.status(400).json({ message: 'Subject is required' });
    }

    if (subject.trim().length > 200) {
      return res.status(400).json({ message: 'Subject cannot exceed 200 characters' });
    }

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ message: 'Message cannot be empty' });
    }

    if (message.trim().length > 4000) {
      return res.status(400).json({ message: 'Message cannot exceed 4000 characters' });
    }

    // Look for recent moderation action if it's an appeal
    let relatedModerationActionId = null;
    if (category === 'suspension_appeal') {
      const recentModAction = await ModerationAction.findOne({
        affectedUser: currentUser._id,
        actionType: { $in: ['temporary_suspension', 'permanent_suspension'] }
      }).sort({ createdAt: -1 });

      if (recentModAction) {
        relatedModerationActionId = recentModAction._id;
      }
    }

    const ticketNumber = await SupportTicket.generateTicketNumber();

    const ticket = new SupportTicket({
      ticketNumber,
      creator: currentUser._id,
      creatorEmail: currentUser.email,
      accountStatusAtCreation: currentUser.accountStatus,
      category,
      subject: subject.trim(),
      status: 'open',
      priority: category === 'suspension_appeal' ? 'high' : 'normal',
      messages: [{
        sender: currentUser._id,
        senderRole: 'user',
        senderDisplayName: currentUser.displayName || 'Player',
        text: message.trim(),
        createdAt: new Date()
      }],
      relatedModerationAction: relatedModerationActionId
    });

    await ticket.save();

    // Notify Super Admins of new ticket
    const admins = await UserProfile.find({ role: 'super_admin' }).select('_id accountStatus');
    for (const admin of admins) {
      const notif = await Notification.create({
        recipient: admin._id,
        title: `New Support Ticket [${ticketNumber}]`,
        message: `${currentUser.displayName || currentUser.email} created a ${category.replace('_', ' ')} ticket: "${subject.trim().slice(0, 50)}"`
      });
      deliverNotification(notif, {
        recipientId: admin._id,
        accountStatus: admin.accountStatus || 'active'
      });
    }

    return res.status(201).json(ticket.toUserDTO());
  } catch (error) {
    console.error('Error creating support ticket:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

/**
 * GET /api/support/tickets
 * Lists tickets owned by the authenticated user.
 */
export const getUserTickets = async (req, res) => {
  try {
    const { uid } = req.user;
    const currentUser = await UserProfile.findOne({ firebaseUid: uid });
    if (!currentUser) return res.status(404).json({ message: 'User profile not found' });

    const tickets = await SupportTicket.find({ creator: currentUser._id })
      .sort({ updatedAt: -1, createdAt: -1 });

    const dtos = tickets.map(t => t.toUserDTO());
    return res.status(200).json(dtos);
  } catch (error) {
    console.error('Error fetching user tickets:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

/**
 * GET /api/support/tickets/:id
 * Retrieve a specific ticket for the user.
 */
export const getTicketDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const { uid } = req.user;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid ticket ID format' });
    }

    const currentUser = await UserProfile.findOne({ firebaseUid: uid });
    if (!currentUser) return res.status(404).json({ message: 'User profile not found' });

    const ticket = await SupportTicket.findById(id);
    if (!ticket) return res.status(404).json({ message: 'Support ticket not found' });

    const isStaff = currentUser.role === 'super_admin';
    const isOwner = ticket.creator.toString() === currentUser._id.toString();

    if (!isStaff && !isOwner) {
      return res.status(403).json({ message: 'Not authorized to view this ticket' });
    }

    if (isStaff) {
      return res.status(200).json(ticket.toStaffDTO());
    }

    return res.status(200).json(ticket.toUserDTO());
  } catch (error) {
    console.error('Error fetching ticket details:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

/**
 * POST /api/support/tickets/:id/reply
 * Add a public reply to a ticket.
 */
export const replyTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const { text } = req.body;
    const { uid } = req.user;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid ticket ID format' });
    }

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ message: 'Reply message cannot be empty' });
    }

    if (text.trim().length > 4000) {
      return res.status(400).json({ message: 'Reply message cannot exceed 4000 characters' });
    }

    const currentUser = await UserProfile.findOne({ firebaseUid: uid });
    if (!currentUser) return res.status(404).json({ message: 'User profile not found' });

    const ticket = await SupportTicket.findById(id);
    if (!ticket) return res.status(404).json({ message: 'Support ticket not found' });

    const isStaff = currentUser.role === 'super_admin';
    const isOwner = ticket.creator.toString() === currentUser._id.toString();

    if (!isStaff && !isOwner) {
      return res.status(403).json({ message: 'Not authorized to reply to this ticket' });
    }

    if (ticket.status === 'closed') {
      return res.status(400).json({ message: 'Cannot reply to a closed ticket' });
    }

    const senderRole = isStaff ? 'staff' : 'user';
    const senderDisplayName = isStaff ? 'ZYNC Support' : (currentUser.displayName || 'Player');

    ticket.messages.push({
      sender: currentUser._id,
      senderRole,
      senderDisplayName,
      text: text.trim(),
      createdAt: new Date()
    });

    if (isStaff) {
      // If staff replies, transition from open/waiting_on_user to in_progress or waiting_on_user
      if (ticket.status === 'open') {
        ticket.status = 'in_progress';
      }
      // Notify ticket creator
      const notif = await Notification.create({
        recipient: ticket.creator,
        title: `Reply to Ticket [${ticket.ticketNumber}]`,
        message: `ZYNC Support replied to "${ticket.subject.slice(0, 40)}": "${text.trim().slice(0, 60)}"`
      });
      deliverNotification(notif, {
        recipientId: ticket.creator,
        checkStatus: true
      });
    } else {
      // If user replies, transition status to open if it was waiting_on_user or resolved
      if (['waiting_on_user', 'resolved'].includes(ticket.status)) {
        ticket.status = 'open';
      }
      // Notify staff (assigned staff or all admins)
      const notifyTarget = ticket.assignedStaff || null;
      if (notifyTarget) {
        const notif = await Notification.create({
          recipient: notifyTarget,
          title: `New User Reply [${ticket.ticketNumber}]`,
          message: `${currentUser.displayName || 'User'} replied to ticket "${ticket.subject.slice(0, 40)}"`
        });
        deliverNotification(notif, {
          recipientId: notifyTarget,
          checkStatus: true
        });
      } else {
        const admins = await UserProfile.find({ role: 'super_admin' }).select('_id accountStatus');
        for (const admin of admins) {
          const notif = await Notification.create({
            recipient: admin._id,
            title: `New User Reply [${ticket.ticketNumber}]`,
            message: `${currentUser.displayName || 'User'} replied to ticket "${ticket.subject.slice(0, 40)}"`
          });
          deliverNotification(notif, {
            recipientId: admin._id,
            accountStatus: admin.accountStatus || 'active'
          });
        }
      }
    }

    await ticket.save();

    return res.status(201).json(isStaff ? ticket.toStaffDTO() : ticket.toUserDTO());
  } catch (error) {
    console.error('Error replying to ticket:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// ==========================================
// STAFF-ONLY SUPPORT TICKET CONTROLLERS
// ==========================================

// Helper to escape special regex characters for literal matching
const escapeRegex = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * GET /api/support/admin/tickets
 * List tickets with staff filters (status, category, priority, assignment, search).
 */
export const getStaffTickets = async (req, res) => {
  try {
    const query = {};

    if (req.query.status && ['open', 'in_progress', 'waiting_on_user', 'resolved', 'closed'].includes(req.query.status)) {
      query.status = req.query.status;
    }

    if (req.query.category && VALID_CATEGORIES.includes(req.query.category)) {
      query.category = req.query.category;
    }

    if (req.query.priority && ['low', 'normal', 'high', 'urgent'].includes(req.query.priority)) {
      query.priority = req.query.priority;
    }

    if (req.query.assignedStaff) {
      if (req.query.assignedStaff === 'unassigned') {
        query.assignedStaff = null;
      } else {
        if (!mongoose.Types.ObjectId.isValid(req.query.assignedStaff)) {
          return res.status(400).json({ message: 'Invalid assigned staff ID format' });
        }
        query.assignedStaff = req.query.assignedStaff;
      }
    }

    if (req.query.search !== undefined) {
      if (typeof req.query.search !== 'string') {
        return res.status(400).json({ message: 'Search query must be a string' });
      }

      const trimmedSearch = req.query.search.trim();
      if (trimmedSearch.length > 100) {
        return res.status(400).json({ message: 'Search query exceeds maximum length of 100 characters' });
      }

      if (trimmedSearch.length > 0) {
        const searchRegex = new RegExp(escapeRegex(trimmedSearch), 'i');
        query.$or = [
          { ticketNumber: searchRegex },
          { subject: searchRegex },
          { creatorEmail: searchRegex }
        ];
      }
    }

    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    const total = await SupportTicket.countDocuments(query);
    const tickets = await SupportTicket.find(query)
      .populate('creator', 'displayName email accountStatus')
      .populate('assignedStaff', 'displayName email')
      .sort({ updatedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit);

    return res.status(200).json({
      tickets: tickets.map(t => t.toStaffDTO()),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching staff tickets:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

/**
 * PATCH /api/support/admin/tickets/:id
 * Update status, priority, or assignedStaff.
 */
export const updateTicketStaffMeta = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, priority, assignedStaff } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid ticket ID format' });
    }

    const ticket = await SupportTicket.findById(id);
    if (!ticket) return res.status(404).json({ message: 'Support ticket not found' });

    let statusChanged = false;
    let oldStatus = ticket.status;

    if (status) {
      if (!['open', 'in_progress', 'waiting_on_user', 'resolved', 'closed'].includes(status)) {
        return res.status(400).json({ message: 'Invalid status' });
      }
      if (ticket.status !== status) {
        statusChanged = true;
        ticket.status = status;
        if (status === 'resolved' || status === 'closed') {
          ticket.resolvedAt = new Date();
        } else {
          ticket.resolvedAt = null;
        }
      }
    }

    if (priority) {
      if (!['low', 'normal', 'high', 'urgent'].includes(priority)) {
        return res.status(400).json({ message: 'Invalid priority' });
      }
      ticket.priority = priority;
    }

    if (assignedStaff !== undefined) {
      if (assignedStaff === null || assignedStaff === '') {
        ticket.assignedStaff = null;
      } else {
        if (!mongoose.Types.ObjectId.isValid(assignedStaff)) {
          return res.status(400).json({ message: 'Invalid assigned staff ID format' });
        }
        const staffDoc = await UserProfile.findById(assignedStaff);
        if (!staffDoc || staffDoc.role !== 'super_admin') {
          return res.status(400).json({ message: 'Target assigned user is not authorized staff' });
        }
        ticket.assignedStaff = staffDoc._id;
      }
    }

    await ticket.save();

    // If status changed to resolved or closed, notify user
    if (statusChanged && ['resolved', 'closed', 'waiting_on_user'].includes(ticket.status)) {
      const notif = await Notification.create({
        recipient: ticket.creator,
        title: `Ticket Status Updated [${ticket.ticketNumber}]`,
        message: `Your ticket "${ticket.subject.slice(0, 40)}" status is now "${ticket.status.replace('_', ' ')}"`
      });
      deliverNotification(notif, {
        recipientId: ticket.creator,
        checkStatus: true
      });
    }

    return res.status(200).json(ticket.toStaffDTO());
  } catch (error) {
    console.error('Error updating ticket meta:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

/**
 * POST /api/support/admin/tickets/:id/notes
 * Add internal staff note (never visible to ordinary users).
 */
export const addInternalNote = async (req, res) => {
  try {
    const { id } = req.params;
    const { note } = req.body;
    const { uid } = req.user;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid ticket ID format' });
    }

    if (!note || note.trim().length === 0) {
      return res.status(400).json({ message: 'Internal note cannot be empty' });
    }

    if (note.trim().length > 4000) {
      return res.status(400).json({ message: 'Internal note cannot exceed 4000 characters' });
    }

    const currentStaff = await UserProfile.findOne({ firebaseUid: uid });
    if (!currentStaff || currentStaff.role !== 'super_admin') {
      return res.status(403).json({ message: 'Only authorized staff can add internal notes' });
    }

    const ticket = await SupportTicket.findById(id);
    if (!ticket) return res.status(404).json({ message: 'Support ticket not found' });

    ticket.internalNotes.push({
      staff: currentStaff._id,
      staffDisplayName: currentStaff.displayName || 'Staff Member',
      note: note.trim(),
      createdAt: new Date()
    });

    await ticket.save();

    return res.status(201).json(ticket.toStaffDTO());
  } catch (error) {
    console.error('Error adding internal note:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};
