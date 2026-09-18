import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import Connection from '../models/Connection.js';
import UserProfile from '../models/UserProfile.js';

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

    const conversations = await Conversation.find({ participants: currentUser._id })
      .populate('participants', 'displayName isOnline onlineUntil')
      .populate('lastMessage')
      .sort({ updatedAt: -1 });

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
    
    const currentUser = await getCurrentProfile(uid);
    if (!currentUser) return res.status(404).json({ message: 'Profile not found' });

    if (currentUser._id.toString() === targetUserId) {
      return res.status(400).json({ message: 'Cannot start conversation with yourself' });
    }

    // Authorization check: Must have accepted connection
    const isConnected = await checkAcceptedConnection(currentUser._id, targetUserId);
    if (!isConnected) {
      return res.status(403).json({ message: 'Cannot chat with users who are not connected friends' });
    }

    // Find existing conversation
    let conversation = await Conversation.findOne({
      participants: { $all: [currentUser._id, targetUserId], $size: 2 }
    }).populate('participants', 'displayName isOnline onlineUntil');

    if (!conversation) {
      // Create new conversation
      conversation = new Conversation({
        participants: [currentUser._id, targetUserId]
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

    const currentUser = await getCurrentProfile(uid);
    if (!currentUser) return res.status(404).json({ message: 'Profile not found' });

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) return res.status(404).json({ message: 'Conversation not found' });

    // Auth check: User must be a participant
    if (!conversation.participants.includes(currentUser._id)) {
      return res.status(403).json({ message: 'Not authorized to view this conversation' });
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
    if (!conversation.participants.includes(currentUser._id)) {
      return res.status(403).json({ message: 'Not authorized to send messages in this conversation' });
    }

    // Auth check: Check connection still exists/is accepted before allowing message
    // Find the other participant
    const otherParticipantId = conversation.participants.find(p => p.toString() !== currentUser._id.toString());
    const isConnected = await checkAcceptedConnection(currentUser._id, otherParticipantId);
    if (!isConnected) {
      return res.status(403).json({ message: 'Cannot chat with users who are not connected friends' });
    }

    const message = new Message({
      conversationId,
      sender: currentUser._id,
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
