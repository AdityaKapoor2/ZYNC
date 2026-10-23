import Notification from '../models/Notification.js';
import UserProfile from '../models/UserProfile.js';
import { getIO } from '../config/socket.js';
import { resolveRecipientRoom } from '../services/notificationService.js';

const getUserProfile = async (req) => {
  if (req.user?._id && req.user?.accountStatus) {
    return { _id: req.user._id, accountStatus: req.user.accountStatus };
  }
  if (req.user?._id) {
    const user = await UserProfile.findById(req.user._id).select('_id accountStatus').lean();
    return user || { _id: req.user._id, accountStatus: 'active' };
  }
  if (req.user?.uid) {
    const user = await UserProfile.findOne({ firebaseUid: req.user.uid }).select('_id accountStatus').lean();
    return user;
  }
  return null;
};

const getUserId = async (req) => {
  const profile = await getUserProfile(req);
  return profile ? profile._id : null;
};

export const getUserNotifications = async (req, res) => {
  try {
    const userId = await getUserId(req);
    if (!userId) return res.status(404).json({ message: 'User not found' });

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const total = await Notification.countDocuments({ recipient: userId });
    const notifications = await Notification.find({ recipient: userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    return res.status(200).json({
      notifications,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      totalCount: total
    });
  } catch (error) {
    console.error('Error in getUserNotifications:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const getUnreadCount = async (req, res) => {
  try {
    const userId = await getUserId(req);
    if (!userId) return res.status(404).json({ message: 'User not found' });

    const count = await Notification.countDocuments({ recipient: userId, read: false });
    return res.status(200).json({ count });
  } catch (error) {
    console.error('Error in getUnreadCount:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const markAsRead = async (req, res) => {
  try {
    const profile = await getUserProfile(req);
    const userId = profile?._id;
    if (!userId) return res.status(404).json({ message: 'User not found' });

    const { id } = req.params;
    const notification = await Notification.findOneAndUpdate(
      { _id: id, recipient: userId },
      { read: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    // Post-commit Socket.IO emission for cross-device sync
    try {
      const io = getIO();
      if (io) {
        const room = resolveRecipientRoom(userId, profile.accountStatus);
        if (room) {
          io.to(room).emit('notification:read', {
            _id: notification._id.toString(),
            read: true
          });
        }
      }
    } catch (socketErr) {
      console.error('[NotificationController] Failed to emit notification:read:', socketErr?.message || socketErr);
    }

    return res.status(200).json(notification);
  } catch (error) {
    console.error('Error in markAsRead:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const markAllAsRead = async (req, res) => {
  try {
    const profile = await getUserProfile(req);
    const userId = profile?._id;
    if (!userId) return res.status(404).json({ message: 'User not found' });

    const cutoff = new Date();

    const result = await Notification.updateMany(
      { recipient: userId, read: false, createdAt: { $lte: cutoff } },
      { read: true }
    );

    // Post-commit Socket.IO emission for cross-device sync
    try {
      const io = getIO();
      if (io) {
        const room = resolveRecipientRoom(userId, profile.accountStatus);
        if (room) {
          io.to(room).emit('notification:read_all', {
            readAt: cutoff.toISOString(),
            modifiedCount: result.modifiedCount || 0
          });
        }
      }
    } catch (socketErr) {
      console.error('[NotificationController] Failed to emit notification:read_all:', socketErr?.message || socketErr);
    }

    return res.status(200).json({
      success: true,
      message: 'All notifications marked as read',
      readAt: cutoff.toISOString(),
      modifiedCount: result.modifiedCount || 0
    });
  } catch (error) {
    console.error('Error in markAllAsRead:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
