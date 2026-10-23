import mongoose from 'mongoose';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import Connection from '../models/Connection.js';
import UserProfile from '../models/UserProfile.js';
import ModerationAction from '../models/ModerationAction.js';
import Report from '../models/Report.js';
import { getIO } from '../config/socket.js';

// Helper to get the current user profile from Firebase UID
const getCurrentProfile = async (uid) => {
  return await UserProfile.findOne({ firebaseUid: uid });
};

// Check if two users have an accepted connection
const checkAcceptedConnection = async (user1Id, user2Id) => {
  const connection = await Connection.findOne({
    $or: [
      { requester: user1Id, recipient: user2Id },
      { requester: user2Id, recipient: user1Id }
    ],
    status: 'accepted'
  });
  return !!connection;
};// Helper to sanitize participant presence when visibilityPreference is invisible
const sanitizePresenceParticipant = (p) => {
  if (!p) return p;
  const obj = p.toObject ? p.toObject() : { ...p };
  if (obj.visibilityPreference === 'invisible') {
    obj.isOnline = false;
    obj.onlineUntil = null;
  }
  delete obj.visibilityPreference;
  return obj;
};


// Get all conversations for current user
export const getConversations = async (req, res) => {
  try {
    const { uid } = req.user;
    const currentUser = await getCurrentProfile(uid);
    if (!currentUser) return res.status(404).json({ message: 'Profile not found' });

    const query = { participants: currentUser._id };
    if (currentUser.accountStatus === 'suspended' && currentUser.role !== 'super_admin') {
      query.isModeration = true;
    }

    const conversations = await Conversation.find(query)
      .populate('participants', 'displayName isOnline onlineUntil role visibilityPreference')
      .populate('lastMessage')
      .sort({ lastMessageAt: -1, updatedAt: -1 });

    const sanitizedConversations = conversations.map(conv => {
      const convObj = conv.toObject ? conv.toObject() : { ...conv };
      if (Array.isArray(convObj.participants)) {
        convObj.participants = convObj.participants.map(sanitizePresenceParticipant);
      }
      return convObj;
    });

    return res.status(200).json(sanitizedConversations);
  } catch (error) {
    console.error('Error getting conversations:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Get receive-only inbox activity for current user
export const getInbox = async (req, res) => {
  try {
    const { uid } = req.user;
    const currentUser = await getCurrentProfile(uid);
    if (!currentUser) return res.status(404).json({ message: 'Profile not found' });

    const query = {
      participants: currentUser._id,
      lastMessage: { $exists: true, $ne: null }
    };

    if (currentUser.accountStatus === 'suspended' && currentUser.role !== 'super_admin') {
      query.isModeration = true;
    }

    const conversations = await Conversation.find(query)
      .populate('participants', 'displayName isOnline onlineUntil role visibilityPreference')
      .populate('lastMessage')
      .sort({ lastMessageAt: -1, updatedAt: -1 });

    const currentUserIdStr = currentUser._id.toString();
    const inboxItems = [];

    for (const conv of conversations) {
      if (!conv.lastMessage) continue;

      const lastSenderIdStr = (conv.lastMessage.sender?._id || conv.lastMessage.sender)?.toString();

      // Receive-only rule:
      // A conversation is eligible for an Inbox item only when its latest persisted message
      // was sent by someone other than the requesting user.
      if (lastSenderIdStr === currentUserIdStr) {
        continue;
      }

      // Calculate persistent sequence-based unread status for the requesting user
      const userRead = Array.isArray(conv.readState)
        ? conv.readState.find(r => r.user?.toString() === currentUserIdStr)
        : null;

      let userLastReadSeq;
      if (userRead && typeof userRead.lastReadSeq === 'number') {
        userLastReadSeq = userRead.lastReadSeq;
      } else if (Array.isArray(conv.readState) && conv.readState.length > 0) {
        userLastReadSeq = 0;
      } else {
        // Migration-free compatibility rule for legacy conversations with uninitialized readState:
        // Treat incoming message at frontier as unread without treating entire historical chain as unread
        userLastReadSeq = Math.max(0, (conv.lastSeq || 1) - 1);
      }

      const isUnread = (conv.lastSeq > userLastReadSeq);

      // Serialize lastMessage: never expose the private message body for friend messages
      const lastMsgObj = conv.lastMessage.toObject ? conv.lastMessage.toObject() : { ...conv.lastMessage };
      let safeLastMessage;

      if (conv.isModeration) {
        // Preserve official notice text for moderation/appeal communications (as expected by tests)
        safeLastMessage = lastMsgObj;
      } else {
        // Normal friend conversation: strip original private message text completely
        const { text, ...restOfMsg } = lastMsgObj;
        safeLastMessage = {
          ...restOfMsg,
          activityText: 'Just messaged you'
        };
      }

      const safeParticipants = Array.isArray(conv.participants)
        ? conv.participants.map(sanitizePresenceParticipant)
        : conv.participants;

      inboxItems.push({
        _id: conv._id,
        participants: safeParticipants,
        lastMessage: safeLastMessage,
        lastMessageAt: conv.lastMessageAt,
        isModeration: conv.isModeration,
        lastSeq: conv.lastSeq,
        lastReadSeq: userLastReadSeq,
        isUnread,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt
      });
    }

    return res.status(200).json(inboxItems);
  } catch (error) {
    console.error('Error getting inbox:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Mark a conversation as read up to a specified sequence or current lastSeq
export const markConversationAsRead = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { uid } = req.user;
    const { readSeq } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({ message: 'Invalid conversation ID format' });
    }

    const currentUser = await getCurrentProfile(uid);
    if (!currentUser) return res.status(404).json({ message: 'Profile not found' });

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) return res.status(404).json({ message: 'Conversation not found' });

    const currentUserIdStr = currentUser._id.toString();

    // Authorization: User must be a participant in the conversation
    const isParticipant = conversation.participants.some(p => p.toString() === currentUserIdStr);
    if (!isParticipant) {
      // Do not disclose whether unrelated users' conversations exist
      return res.status(404).json({ message: 'Conversation not found' });
    }

    // Suspended users can only interact with moderation conversations
    if (currentUser.accountStatus === 'suspended' && !conversation.isModeration) {
      return res.status(403).json({ message: 'Account is suspended', code: 'ACCOUNT_SUSPENDED' });
    }

    // Validate client-provided readSeq against conversation sequence frontier
    let targetSeq = conversation.lastSeq;
    if (readSeq !== undefined) {
      if (typeof readSeq !== 'number' || !Number.isSafeInteger(readSeq) || readSeq < 0) {
        return res.status(400).json({ message: 'Invalid readSeq: must be a non-negative integer' });
      }
      if (readSeq > conversation.lastSeq) {
        return res.status(400).json({ message: 'readSeq cannot exceed conversation lastSeq' });
      }
      targetSeq = readSeq;
    }

    // Monotonic read sequence rule: read sequence cannot move backward
    const existingEntry = Array.isArray(conversation.readState)
      ? conversation.readState.find(r => r.user?.toString() === currentUserIdStr)
      : null;

    const currentLastReadSeq = (existingEntry && typeof existingEntry.lastReadSeq === 'number')
      ? existingEntry.lastReadSeq
      : 0;

    // Atomic monotonic update with advancement detection
    let didAdvance = false;
    let updatedConv = null;

    if (!existingEntry) {
      // First read entry for this user in this conversation
      updatedConv = await Conversation.findOneAndUpdate(
        { _id: conversation._id, 'readState.user': { $ne: currentUser._id } },
        { $push: { readState: { user: currentUser._id, lastReadSeq: targetSeq } } },
        { returnDocument: 'after' }
      );
      if (updatedConv) {
        didAdvance = targetSeq > 0;
      }
    }

    if (!updatedConv) {
      // Entry already exists: advance ONLY if targetSeq strictly exceeds current stored lastReadSeq
      updatedConv = await Conversation.findOneAndUpdate(
        {
          _id: conversation._id,
          readState: {
            $elemMatch: {
              user: currentUser._id,
              lastReadSeq: { $lt: targetSeq }
            }
          }
        },
        { $set: { 'readState.$.lastReadSeq': targetSeq } },
        { returnDocument: 'after' }
      );
      if (updatedConv) {
        didAdvance = true;
      }
    }

    // If no document was modified (no advance, duplicate, or older sequence), fetch current authoritative state
    const finalConv = updatedConv || (await Conversation.findById(conversation._id));
    if (!finalConv) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    const currentEntry = Array.isArray(finalConv.readState)
      ? finalConv.readState.find(r => r.user?.toString() === currentUserIdStr)
      : null;
    const finalReadSeq = currentEntry?.lastReadSeq || 0;
    const isUnread = (finalConv.lastSeq > finalReadSeq);

    const io = getIO();
    if (io && didAdvance) {
      // 1. Post-update real-time read receipt emission (to other participant for C2 "Seen")
      const otherParticipantId = conversation.participants.find(p => p.toString() !== currentUserIdStr);
      if (otherParticipantId) {
        const targetRoom = conversation.isModeration
          ? `official:${otherParticipantId}`
          : `user:${otherParticipantId}`;

        try {
          io.to(targetRoom).emit('chat:read', {
            conversationId: finalConv._id.toString(),
            readerId: currentUser._id.toString(),
            lastReadSeq: finalReadSeq
          });
        } catch (emitError) {
          console.error('[Chat] Post-read chat:read emission failed:', emitError?.message || emitError);
        }
      }

      // 2. Reader-side multi-tab synchronization (to reader's authenticated room)
      const readerRoom = conversation.isModeration
        ? `official:${currentUser._id}`
        : `user:${currentUser._id}`;

      try {
        io.to(readerRoom).emit('inbox:read', {
          conversationId: finalConv._id.toString(),
          readerId: currentUser._id.toString(),
          lastReadSeq: finalReadSeq,
          lastSeq: finalConv.lastSeq,
          isUnread
        });
      } catch (readerEmitError) {
        console.error('[Chat] Post-read inbox:read emission failed:', readerEmitError?.message || readerEmitError);
      }
    }

    return res.status(200).json({
      conversationId: finalConv._id,
      lastReadSeq: finalReadSeq,
      lastSeq: finalConv.lastSeq,
      isUnread
    });
  } catch (error) {
    console.error('Error marking conversation as read:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Get or create a 1-on-1 conversation
export const getOrCreateConversation = async (req, res) => {
  try {
    const { targetUserId } = req.params;
    const { uid } = req.user;
    
    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
      return res.status(400).json({ message: 'Invalid user ID format' });
    }

    const currentUser = await getCurrentProfile(uid);
    if (!currentUser) return res.status(404).json({ message: 'Profile not found' });

    if (currentUser._id.toString() === targetUserId) {
      return res.status(400).json({ message: 'Cannot start conversation with yourself' });
    }

    // Find target user
    const targetUser = await UserProfile.findById(targetUserId).select('role accountStatus');
    if (!targetUser) return res.status(404).json({ message: 'Target profile not found' });

    // Suspended users cannot initiate or retrieve ordinary conversations
    if (currentUser.accountStatus === 'suspended') {
      return res.status(403).json({ message: 'Account is suspended', code: 'ACCOUNT_SUSPENDED' });
    }

    // Check if connected friends
    const isConnected = await checkAcceptedConnection(currentUser._id, targetUserId);
    if (!isConnected) {
      if (targetUser.role === 'super_admin' || currentUser.role === 'super_admin') {
        return res.status(403).json({ message: 'Direct chat with Super Admin is not permitted' });
      }
      return res.status(403).json({ message: 'Cannot chat with users who are not connected friends' });
    }

    // Find existing normal conversation
    let conversation = await Conversation.findOne({
      participants: { $all: [currentUser._id, targetUserId], $size: 2 },
      isModeration: { $ne: true }
    }).populate('participants', 'displayName isOnline onlineUntil visibilityPreference');

    if (!conversation) {
      // Create new conversation
      conversation = new Conversation({
        participants: [currentUser._id, targetUserId],
        isModeration: false
      });
      await conversation.save();
      await conversation.populate('participants', 'displayName isOnline onlineUntil visibilityPreference');
    }

    const convObj = conversation.toObject ? conversation.toObject() : { ...conversation };
    if (Array.isArray(convObj.participants)) {
      convObj.participants = convObj.participants.map(sanitizePresenceParticipant);
    }

    return res.status(200).json(convObj);
  } catch (error) {
    console.error('Error getting or creating conversation:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Get messages for a conversation with sequence-based pagination
export const getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { uid } = req.user;
    const { afterSeq, beforeSeq, limit: rawLimit } = req.query;

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({ message: 'Invalid conversation ID format' });
    }

    // Mutual exclusivity check
    if (afterSeq !== undefined && beforeSeq !== undefined) {
      return res.status(400).json({ message: 'Cannot specify both "afterSeq" and "beforeSeq"' });
    }

    // Strict validation for afterSeq
    let parsedAfterSeq = undefined;
    if (afterSeq !== undefined) {
      if (typeof afterSeq !== 'string' || !/^\d+$/.test(afterSeq.trim())) {
        return res.status(400).json({ message: 'Invalid "afterSeq": must be a non-negative integer' });
      }
      parsedAfterSeq = Number(afterSeq.trim());
      if (!Number.isSafeInteger(parsedAfterSeq) || parsedAfterSeq < 0) {
        return res.status(400).json({ message: 'Invalid "afterSeq": must be a non-negative integer' });
      }
    }

    // Strict validation for beforeSeq
    let parsedBeforeSeq = undefined;
    if (beforeSeq !== undefined) {
      if (typeof beforeSeq !== 'string' || !/^\d+$/.test(beforeSeq.trim())) {
        return res.status(400).json({ message: 'Invalid "beforeSeq": must be a positive integer' });
      }
      parsedBeforeSeq = Number(beforeSeq.trim());
      if (!Number.isSafeInteger(parsedBeforeSeq) || parsedBeforeSeq <= 0) {
        return res.status(400).json({ message: 'Invalid "beforeSeq": must be a positive integer' });
      }
    }

    // Strict validation and clamping for limit (range 1-100, default 50)
    let limit = 50;
    if (rawLimit !== undefined) {
      if (typeof rawLimit !== 'string' || !/^\d+$/.test(rawLimit.trim())) {
        return res.status(400).json({ message: 'Invalid "limit": must be a positive integer' });
      }
      const parsedLimit = Number(rawLimit.trim());
      if (!Number.isSafeInteger(parsedLimit) || parsedLimit <= 0) {
        return res.status(400).json({ message: 'Invalid "limit": must be a positive integer' });
      }
      limit = Math.min(Math.max(parsedLimit, 1), 100);
    }

    const currentUser = await getCurrentProfile(uid);
    if (!currentUser) return res.status(404).json({ message: 'Profile not found' });

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) return res.status(404).json({ message: 'Conversation not found' });

    // Auth check: User must be a participant
    if (!conversation.participants.some(p => p.toString() === currentUser._id.toString())) {
      return res.status(403).json({ message: 'Not authorized to view this conversation' });
    }

    // Active user check
    if (currentUser.accountStatus === 'suspended' && currentUser.role !== 'super_admin') {
      if (!conversation.isModeration) {
        return res.status(403).json({ message: 'Account is suspended', code: 'ACCOUNT_SUSPENDED' });
      }
    }

    const lastSeq = conversation.lastSeq || 0;

    // Ahead of authoritative server frontier -> signal reset
    if (parsedAfterSeq !== undefined && parsedAfterSeq > lastSeq) {
      return res.status(200).json({
        messages: [],
        lastSeq,
        hasMore: false,
        reset: true
      });
    }

    // Case 1: Empty conversation
    if (lastSeq === 0) {
      return res.status(200).json({
        messages: [],
        lastSeq: 0,
        hasMore: false,
        reset: false
      });
    }

    // Case 2: Forward incremental recovery (afterSeq)
    if (parsedAfterSeq !== undefined) {
      const rows = await Message.find({
        conversationId: conversation._id,
        seq: { $gt: parsedAfterSeq }
      })
        .sort({ seq: 1 })
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const pageMessages = rows.slice(0, limit);

      return res.status(200).json({
        messages: pageMessages,
        lastSeq,
        hasMore,
        reset: false
      });
    }

    // Case 3: Backward history pagination (beforeSeq)
    if (parsedBeforeSeq !== undefined) {
      const rows = await Message.find({
        conversationId: conversation._id,
        seq: { $lt: parsedBeforeSeq }
      })
        .sort({ seq: -1 })
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const pageMessages = rows.slice(0, limit).reverse(); // Chronological ascending order

      return res.status(200).json({
        messages: pageMessages,
        lastSeq,
        hasMore,
        reset: false
      });
    }

    // Case 4: Default initial baseline load (latest messages)
    const rows = await Message.find({
      conversationId: conversation._id
    })
      .sort({ seq: -1 })
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const pageMessages = rows.slice(0, limit).reverse(); // Chronological ascending order

    return res.status(200).json({
      messages: pageMessages,
      lastSeq,
      hasMore,
      reset: false
    });
  } catch (error) {
    console.error('Error getting messages:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Send a message
export const sendMessage = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { text, clientMessageId } = req.body;
    const { uid } = req.user;

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({ message: 'Invalid conversation ID format' });
    }

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ message: 'Message cannot be empty' });
    }

    if (text.length > 2000) {
      return res.status(400).json({ message: 'Message exceeds maximum length' });
    }

    const currentUser = await getCurrentProfile(uid);
    if (!currentUser) return res.status(404).json({ message: 'Profile not found' });

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) return res.status(404).json({ message: 'Conversation not found' });

    // Auth check: User must be a participant
    if (!conversation.participants.some(p => p.toString() === currentUser._id.toString())) {
      return res.status(403).json({ message: 'Not authorized to send messages in this conversation' });
    }

    // Find the other participant
    const otherParticipantId = conversation.participants.find(p => p.toString() !== currentUser._id.toString());
    if (!otherParticipantId) {
      return res.status(403).json({ message: 'Invalid conversation participants' });
    }

    const otherUser = await UserProfile.findById(otherParticipantId).select('_id role accountStatus displayName');
    if (!otherUser) {
      return res.status(404).json({ message: 'Conversation participant not found' });
    }

    // Handle senderContext request validation
    if (req.body.senderContext) {
      if (!['user', 'admin'].includes(req.body.senderContext)) {
        return res.status(400).json({ message: 'Invalid senderContext' });
      }

      if (req.body.senderContext === 'admin') {
        if (currentUser.role !== 'super_admin') {
          return res.status(403).json({ message: 'Forbidden: Super Admin role required for admin senderContext' });
        }

        if (!conversation.isModeration) {
          return res.status(403).json({ message: 'Forbidden: Admin sender context is only permitted in authorized moderation conversations' });
        }
      }
    }

    // Authorization & direct Super Admin chat checks
    if (!conversation.isModeration) {
      // Ordinary user conversation
      if (currentUser.accountStatus === 'suspended') {
        return res.status(403).json({ message: 'Account is suspended', code: 'ACCOUNT_SUSPENDED' });
      }

      const isConnected = await checkAcceptedConnection(currentUser._id, otherParticipantId);
      if (!isConnected) {
        if (otherUser.role === 'super_admin' || currentUser.role === 'super_admin') {
          return res.status(403).json({ message: 'Direct chat with Super Admin is not permitted' });
        }
        return res.status(403).json({ message: 'Cannot chat with users who are not connected friends' });
      }
    } else {
      // Moderation conversation
      const isCurrentAdmin = currentUser.role === 'super_admin';
      const isOtherAdmin = otherUser.role === 'super_admin';

      if (isCurrentAdmin === isOtherAdmin) {
        return res.status(403).json({ message: 'Invalid participants for administrative moderation communication' });
      }

      if (!isCurrentAdmin) {
        if (currentUser.accountStatus !== 'suspended') {
          return res.status(403).json({ message: 'Direct chat with Super Admin is not permitted' });
        }

        const hasProvenance = 
          (await Message.exists({ conversationId: conversation._id })) ||
          (await ModerationAction.exists({ affectedUser: currentUser._id })) ||
          (await Report.exists({ reportedUser: currentUser._id }));

        if (!hasProvenance) {
          return res.status(403).json({ message: 'Unauthorized moderation conversation provenance' });
        }
      }
    }

    // Validate clientMessageId (UUID v4 required)
    if (!clientMessageId || typeof clientMessageId !== 'string' || !UUID_V4_REGEX.test(clientMessageId.trim())) {
      return res.status(400).json({ message: 'Valid UUID v4 clientMessageId is required' });
    }
    const cleanClientMessageId = clientMessageId.trim();

    // Idempotency pre-check: Authorization has passed
    const existingMessage = await Message.findOne({
      conversationId: conversation._id,
      clientMessageId: cleanClientMessageId
    });

    if (existingMessage) {
      if (existingMessage.sender.toString() !== currentUser._id.toString()) {
        return res.status(409).json({ message: 'Conflict: clientMessageId has already been used by another sender' });
      }

      if (existingMessage.text !== text.trim()) {
        return res.status(409).json({ message: 'Conflict: clientMessageId cannot be reused with different message content' });
      }

      // Exact retry: return original message without allocating new sequence or emitting duplicate event
      return res.status(200).json(existingMessage);
    }

    // Determine sender identity
    let senderRole = 'user';
    let senderDisplayName = currentUser.displayName || 'Player';

    if (req.body.senderContext === 'admin' && currentUser.role === 'super_admin' && conversation.isModeration) {
      senderRole = 'admin';
      senderDisplayName = 'ZYNC Super Admin';
    }

    // Transactional sequence allocation and message persistence
    const session = await mongoose.startSession();
    let committedMessage = null;
    let duplicateResolved = null;

    try {
      await session.withTransaction(async () => {
        // Concurrency guard inside transaction: recheck if already created in another concurrent request
        const concurrentMsg = await Message.findOne({
          conversationId: conversation._id,
          clientMessageId: cleanClientMessageId
        }).session(session);

        if (concurrentMsg) {
          duplicateResolved = concurrentMsg;
          return;
        }

        // Atomically increment lastSeq
        const updatedConv = await Conversation.findOneAndUpdate(
          { _id: conversation._id },
          { $inc: { lastSeq: 1 } },
          { session, returnDocument: 'after' }
        );

        if (!updatedConv) {
          throw new Error('CONVERSATION_NOT_FOUND');
        }

        const allocatedSeq = updatedConv.lastSeq;

        const message = new Message({
          conversationId: conversation._id,
          sender: currentUser._id,
          senderRole,
          senderDisplayName,
          text: text.trim(),
          seq: allocatedSeq,
          clientMessageId: cleanClientMessageId
        });

        await message.save({ session });

        const existingReadState = Array.isArray(updatedConv.readState) ? updatedConv.readState : [];
        let senderFound = false;
        let recipientFound = false;

        const nextReadState = existingReadState.map(entry => {
          if (entry.user && entry.user.toString() === currentUser._id.toString()) {
            senderFound = true;
            return { user: entry.user, lastReadSeq: allocatedSeq };
          }
          if (entry.user && entry.user.toString() === otherParticipantId.toString()) {
            recipientFound = true;
            return entry;
          }
          return entry;
        });

        if (!senderFound) {
          nextReadState.push({ user: currentUser._id, lastReadSeq: allocatedSeq });
        }
        if (!recipientFound) {
          nextReadState.push({ user: otherParticipantId, lastReadSeq: Math.max(0, allocatedSeq - 1) });
        }

        await Conversation.updateOne(
          { _id: conversation._id },
          {
            $set: {
              lastMessage: message._id,
              lastMessageAt: message.createdAt,
              readState: nextReadState
            }
          },
          { session }
        );

        committedMessage = message;
      });
    } catch (txErr) {
      // Handle potential duplicate-key race (E11000) if two identical transactions committed concurrently
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
      if (duplicateResolved.text !== text.trim()) {
        return res.status(409).json({ message: 'Conflict: clientMessageId cannot be reused with different message content' });
      }
      return res.status(200).json(duplicateResolved);
    }

    if (!committedMessage) {
      return res.status(500).json({ message: 'Failed to commit message' });
    }

    // Post-commit realtime emission (ONLY for newly committed message, NEVER for retries)
    const io = getIO();
    if (io) {
      const targetRoom = conversation.isModeration
        ? `official:${otherParticipantId}`
        : `user:${otherParticipantId}`;
      const senderRoom = conversation.isModeration
        ? `official:${currentUser._id}`
        : `user:${currentUser._id}`;

      // 1. Attempt chat:message emission independently
      try {
        const payload = committedMessage.toObject ? committedMessage.toObject() : committedMessage;
        io.to(targetRoom).to(senderRoom).emit('chat:message', payload);
      } catch (emitError) {
        console.error('[Chat] Post-commit chat:message emission failed:', emitError?.message || emitError);
      }

      // 2. Attempt inbox:activity emission independently
      try {
        // Server-side targeted inbox:activity event: emitted ONLY to recipient room
        io.to(targetRoom).emit('inbox:activity', {
          conversationId: conversation._id,
          sender: currentUser._id,
          senderDisplayName,
          activityText: 'Just messaged you',
          seq: committedMessage.seq,
          createdAt: committedMessage.createdAt,
          isUnread: true
        });
      } catch (inboxError) {
        console.error('[Chat] Post-commit inbox:activity emission failed:', inboxError?.message || inboxError);
      }
    }

    return res.status(201).json(committedMessage);
  } catch (error) {
    console.error('Error sending message:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};
