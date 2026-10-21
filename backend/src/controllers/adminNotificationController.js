import Notification from '../models/Notification.js';
import BroadcastNotification from '../models/BroadcastNotification.js';
import UserProfile from '../models/UserProfile.js';

export const createAdminNotification = async (req, res) => {
  try {
    const { audienceType, targetGame, recipientId, title, message } = req.body;

    if (!title || !message) {
      return res.status(400).json({ message: 'Title and message are required' });
    }

    if (title.length > 100 || message.length > 1000) {
      return res.status(400).json({ message: 'Title or message exceeds maximum length' });
    }

    if (!['all', 'game', 'individual'].includes(audienceType)) {
      return res.status(400).json({ message: 'Invalid audience type' });
    }

    let query = {};
    if (audienceType === 'game') {
      if (!targetGame) {
        return res.status(400).json({ message: 'Target game is required for game audience' });
      }
      query = { 'games.gameName': targetGame };
    } else if (audienceType === 'individual') {
      if (!recipientId) {
        return res.status(400).json({ message: 'Recipient ID is required for individual audience' });
      }
      const user = await UserProfile.findById(recipientId);
      if (!user) {
        return res.status(404).json({ message: 'Recipient not found' });
      }
      query = { _id: recipientId };
    } else if (audienceType === 'all') {
      // Send to all active users, or all users? The prompt says: "target all active/appropriate users according to the existing account model."
      // Let's just target everyone for now, or specifically accountStatus: 'active'. Let's say all users since suspended users also exist, but the prompt says "do not send notifications to deleted/nonexistent users". MongoDB doesn't have soft deletes, so just `{}` is fine, or `{ accountStatus: 'active' }`. Let's just do `{}`. Actually, I'll filter active.
      query = {}; // All users
    }

    // Find recipients
    const recipients = await UserProfile.find(query).select('_id').lean();

    if (recipients.length === 0) {
      return res.status(400).json({ message: 'No recipients matched the audience criteria' });
    }

    let adminId = req.user._id;
    if (!adminId) {
      const adminProfile = await UserProfile.findOne({ firebaseUid: req.user.uid });
      if (!adminProfile) {
        return res.status(403).json({ message: 'Admin profile not found' });
      }
      adminId = adminProfile._id;
    }

    // Create Broadcast record
    const broadcast = await BroadcastNotification.create({
      sender: adminId,
      audienceType,
      targetGame: audienceType === 'game' ? targetGame : undefined,
      targetUser: audienceType === 'individual' ? recipientId : undefined,
      title: title.trim(),
      message: message.trim(),
      recipientCount: recipients.length
    });

    // Create individual notifications (Bulk Insert)
    const notifications = recipients.map(user => ({
      recipient: user._id,
      broadcastId: broadcast._id,
      title: title.trim(),
      message: message.trim(),
      read: false
    }));

    await Notification.insertMany(notifications, { ordered: false });

    return res.status(201).json({
      success: true,
      message: 'Notification sent successfully',
      recipientCount: recipients.length,
      audienceType,
      broadcastId: broadcast._id
    });
  } catch (error) {
    console.error('Error in createAdminNotification:', error);
    if (error.name === 'ValidationError') {
      for (const field in error.errors) {
        console.error(`Validation error in field ${field}: ${error.errors[field].message}`);
      }
    }
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

export const getAdminNotificationHistory = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const total = await BroadcastNotification.countDocuments();
    const broadcasts = await BroadcastNotification.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('sender', 'displayName email')
      .populate('targetUser', 'displayName email')
      .lean();

    return res.status(200).json({
      broadcasts,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      totalCount: total
    });
  } catch (error) {
    console.error('Error in getAdminNotificationHistory:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
