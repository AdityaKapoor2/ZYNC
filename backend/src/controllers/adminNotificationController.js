import Notification from '../models/Notification.js';
import BroadcastNotification from '../models/BroadcastNotification.js';
import UserProfile from '../models/UserProfile.js';
import { deliverBulkNotifications } from '../services/notificationService.js';

const SUPPORTED_GAMES = ['BGMI', 'Brawl Stars', 'Valorant'];

const isEquivalentBroadcast = (broadcast, { audienceType, targetGame, recipientId, title, message }) => {
  if (broadcast.audienceType !== audienceType) return false;
  if (broadcast.title !== title.trim()) return false;
  if (broadcast.message !== message.trim()) return false;

  if (audienceType === 'game') {
    if (broadcast.targetGame !== targetGame) return false;
  } else if (audienceType === 'individual') {
    if (broadcast.targetUser?.toString() !== recipientId?.toString()) return false;
  }

  return true;
};

const isBroadcastRecipientDupError = (err) => {
  if (!err) return false;

  if (err.code === 11000) {
    if (err.keyPattern?.broadcastId && err.keyPattern?.recipient) {
      return true;
    }
    const msg = String(err.message || '');
    if (msg.includes('broadcastId') && msg.includes('recipient')) {
      return true;
    }
    if (Array.isArray(err.writeErrors) && err.writeErrors.length > 0) {
      return err.writeErrors.every(we => 
        we.code === 11000 && 
        (we.keyPattern?.broadcastId || String(we.errmsg || '').includes('broadcastId'))
      );
    }
  }

  if (Array.isArray(err.writeErrors) && err.writeErrors.length > 0) {
    return err.writeErrors.every(we => 
      we.code === 11000 && 
      (we.keyPattern?.broadcastId || String(we.errmsg || '').includes('broadcastId'))
    );
  }

  return false;
};

const getSuccessfullyInsertedDocs = (err) => {
  if (Array.isArray(err?.insertedDocs)) {
    return err.insertedDocs;
  }
  return [];
};

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

    // Validate idempotency key if provided via header or body
    const rawKey = req.headers['idempotency-key'] ?? req.headers['x-idempotency-key'] ?? req.body.idempotencyKey;
    let idempotencyKey = undefined;

    if (rawKey !== undefined) {
      if (typeof rawKey !== 'string') {
        return res.status(400).json({ message: 'Invalid idempotency key format: must be a string' });
      }
      const trimmed = rawKey.trim();
      if (!trimmed) {
        return res.status(400).json({ message: 'Idempotency key cannot be empty' });
      }
      if (trimmed.length > 128) {
        return res.status(400).json({ message: 'Idempotency key exceeds maximum length of 128 characters' });
      }
      idempotencyKey = trimmed;
    }

    let query = {};
    if (audienceType === 'game') {
      if (!targetGame) {
        return res.status(400).json({ message: 'Target game is required for game audience' });
      }
      if (!SUPPORTED_GAMES.includes(targetGame)) {
        return res.status(400).json({ 
          message: `Invalid target game. Allowed games are: ${SUPPORTED_GAMES.join(', ')}` 
        });
      }
      query = { 'games.gameName': targetGame, accountStatus: 'active' };
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
      query = { accountStatus: 'active' }; // Eligible active users only
    }

    // Find recipients
    const recipients = await UserProfile.find(query).select('_id accountStatus').lean();

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

    // Idempotency check: inspect existing broadcast if key provided
    if (idempotencyKey) {
      const existing = await BroadcastNotification.findOne({ sender: adminId, idempotencyKey });
      if (existing) {
        if (!isEquivalentBroadcast(existing, { audienceType, targetGame, recipientId, title, message })) {
          return res.status(409).json({
            message: 'Idempotency key reuse with different parameters',
            code: 'IDEMPOTENCY_KEY_CONFLICT'
          });
        }

        const existingNotifs = await Notification.find({ broadcastId: existing._id }).select('recipient');
        const existingRecipientIds = new Set(existingNotifs.map(n => n.recipient.toString()));

        // Inspect actual intended recipient set: only process recipients who have not yet received a notification
        const pendingRecipients = recipients.filter(u => !existingRecipientIds.has(u._id.toString()));
        if (pendingRecipients.length === 0) {
          // Every intended recipient already has a notification document
          return res.status(200).json({
            success: true,
            message: 'Notification sent successfully',
            recipientCount: existing.recipientCount,
            audienceType: existing.audienceType,
            broadcastId: existing._id,
            idempotent: true
          });
        }

        const missingNotifications = pendingRecipients.map(user => ({
          recipient: user._id,
          broadcastId: existing._id,
          title: title.trim(),
          message: message.trim(),
          read: false
        }));

        let insertedDocs = [];
        try {
          insertedDocs = await Notification.insertMany(missingNotifications, { ordered: false });
        } catch (insertErr) {
          if (isBroadcastRecipientDupError(insertErr)) {
            // Concurrent race collision on broadcastId_1_recipient_1
            insertedDocs = getSuccessfullyInsertedDocs(insertErr);
          } else {
            // Genuine unrelated database error: surface it according to existing REST conventions
            throw insertErr;
          }
        }

        // Deliver real-time notifications ONLY for documents actually inserted by this request
        if (insertedDocs.length > 0) {
          try {
            const statusMap = new Map();
            for (const r of pendingRecipients) {
              statusMap.set(r._id.toString(), r.accountStatus);
            }
            deliverBulkNotifications(insertedDocs, statusMap);
          } catch (deliverErr) {
            console.error('[AdminNotification] Socket delivery failed during idempotent recovery:', deliverErr.message || deliverErr);
          }
        }

        return res.status(200).json({
          success: true,
          message: 'Notification sent successfully',
          recipientCount: existing.recipientCount,
          audienceType: existing.audienceType,
          broadcastId: existing._id,
          idempotent: true
        });
      }
    }

    // Create Broadcast record (handled with concurrency race protection)
    let broadcast;
    try {
      broadcast = await BroadcastNotification.create({
        sender: adminId,
        audienceType,
        targetGame: audienceType === 'game' ? targetGame : undefined,
        targetUser: audienceType === 'individual' ? recipientId : undefined,
        title: title.trim(),
        message: message.trim(),
        recipientCount: recipients.length,
        idempotencyKey: idempotencyKey || undefined
      });
    } catch (createErr) {
      if (createErr.code === 11000 && idempotencyKey) {
        // Concurrency race: another request won the race to persist with the same key
        const existing = await BroadcastNotification.findOne({ sender: adminId, idempotencyKey });
        if (existing) {
          if (!isEquivalentBroadcast(existing, { audienceType, targetGame, recipientId, title, message })) {
            return res.status(409).json({
              message: 'Idempotency key reuse with different parameters',
              code: 'IDEMPOTENCY_KEY_CONFLICT'
            });
          }
          return res.status(200).json({
            success: true,
            message: 'Notification sent successfully',
            recipientCount: existing.recipientCount,
            audienceType: existing.audienceType,
            broadcastId: existing._id,
            idempotent: true
          });
        }
      }
      throw createErr;
    }

    // Create individual notifications (Bulk Insert)
    const notifications = recipients.map(user => ({
      recipient: user._id,
      broadcastId: broadcast._id,
      title: title.trim(),
      message: message.trim(),
      read: false
    }));

    let insertedDocs = [];
    try {
      insertedDocs = await Notification.insertMany(notifications, { ordered: false });
    } catch (insertErr) {
      if (isBroadcastRecipientDupError(insertErr)) {
        insertedDocs = getSuccessfullyInsertedDocs(insertErr);
      } else {
        throw insertErr;
      }
    }

    // Deliver real-time notifications only after successful persistence for inserted docs
    if (insertedDocs.length > 0) {
      try {
        const statusMap = new Map();
        for (const r of recipients) {
          statusMap.set(r._id.toString(), r.accountStatus);
        }
        deliverBulkNotifications(insertedDocs, statusMap);
      } catch (deliverErr) {
        console.error('[AdminNotification] Socket delivery failed:', deliverErr.message || deliverErr);
      }
    }

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
