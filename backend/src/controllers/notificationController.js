import Notification from '../models/Notification.js';
import UserProfile from '../models/UserProfile.js';

const getUserId = async (req) => {
  if (req.user._id) return req.user._id;
  const user = await UserProfile.findOne({ firebaseUid: req.user.uid }).select('_id').lean();
  return user ? user._id : null;
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
    const userId = await getUserId(req);
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

    return res.status(200).json(notification);
  } catch (error) {
    console.error('Error in markAsRead:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const markAllAsRead = async (req, res) => {
  try {
    const userId = await getUserId(req);
    if (!userId) return res.status(404).json({ message: 'User not found' });

    await Notification.updateMany(
      { recipient: userId, read: false },
      { read: true }
    );
    return res.status(200).json({ success: true, message: 'All notifications marked as read' });
  } catch (error) {
    console.error('Error in markAllAsRead:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
