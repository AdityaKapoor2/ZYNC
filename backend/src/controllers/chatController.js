import mongoose from 'mongoose';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import Connection from '../models/Connection.js';
import UserProfile from '../models/UserProfile.js';
import ModerationAction from '../models/ModerationAction.js';
import Report from '../models/Report.js';

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
      .populate('participants', 'displayName isOnline onlineUntil role')
      .populate('lastMessage')
      .sort({ lastMessageAt: -1, updatedAt: -1 });

    return res.status(200).json(conversations);
  } catch (error) {
    console.error('Error getting conversations:', error);
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
    }).populate('participants', 'displayName isOnline onlineUntil');

    if (!conversation) {
      // Create new conversation
      conversation = new Conversation({
        participants: [currentUser._id, targetUserId],
        isModeration: false
      });
      await conversation.save();
      await conversation.populate('participants', 'displayName isOnline onlineUntil');
    }

    return res.status(200).json(conversation);
  } catch (error) {
    console.error('Error getting or creating conversation:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Get messages for a conversation
export const getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { uid } = req.user;

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({ message: 'Invalid conversation ID format' });
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

    const messages = await Message.find({ conversationId })
      .sort({ createdAt: 1 })
      .limit(500); // Simple limit for MVP

    return res.status(200).json(messages);
  } catch (error) {
    console.error('Error getting messages:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Send a message
export const sendMessage = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { text } = req.body;
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
      // Requirement 3: Do not treat conversation.isModeration alone as proof of authorization.
      // Verify the actual authorized workflow, participants, and provenance.
      const isCurrentAdmin = currentUser.role === 'super_admin';
      const isOtherAdmin = otherUser.role === 'super_admin';

      if (isCurrentAdmin === isOtherAdmin) {
        return res.status(403).json({ message: 'Invalid participants for administrative moderation communication' });
      }

      if (!isCurrentAdmin) {
        // Ordinary user sending to Super Admin in moderation conversation
        // Active users cannot direct chat with Super Admin
        if (currentUser.accountStatus !== 'suspended') {
          return res.status(403).json({ message: 'Direct chat with Super Admin is not permitted' });
        }

        // Suspended user: verify provenance of authorized appeal
        const hasProvenance = 
          (await Message.exists({ conversationId: conversation._id })) ||
          (await ModerationAction.exists({ affectedUser: currentUser._id })) ||
          (await Report.exists({ reportedUser: currentUser._id }));

        if (!hasProvenance) {
          return res.status(403).json({ message: 'Unauthorized moderation conversation provenance' });
        }
      }
    }

    // Determine sender identity
    let senderRole = 'user';
    let senderDisplayName = currentUser.displayName || 'Player';

    if (req.body.senderContext === 'admin' && currentUser.role === 'super_admin' && conversation.isModeration) {
      senderRole = 'admin';
      senderDisplayName = 'ZYNC Super Admin';
    }

    const message = new Message({
      conversationId,
      sender: currentUser._id,
      senderRole,
      senderDisplayName,
      text: text.trim()
    });

    await message.save();

    conversation.lastMessage = message._id;
    conversation.lastMessageAt = message.createdAt;
    await conversation.save();

    return res.status(201).json(message);
  } catch (error) {
    console.error('Error sending message:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};
