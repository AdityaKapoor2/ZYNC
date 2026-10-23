import { getIO } from '../config/socket.js';
import UserProfile from '../models/UserProfile.js';

/**
 * Formats a persisted notification document into the canonical payload for Socket.IO delivery.
 * Includes only the necessary fields: _id, title, message, read, createdAt, and ticketNumber if applicable.
 */
export function formatNotificationPayload(notificationDoc) {
  if (!notificationDoc) return null;

  const payload = {
    _id: notificationDoc._id ? notificationDoc._id.toString() : undefined,
    title: notificationDoc.title,
    message: notificationDoc.message,
    read: Boolean(notificationDoc.read),
    createdAt: notificationDoc.createdAt
      ? new Date(notificationDoc.createdAt).toISOString()
      : new Date().toISOString()
  };

  // Attach ticketNumber if explicitly present or embedded in title/message
  if (notificationDoc.ticketNumber) {
    payload.ticketNumber = notificationDoc.ticketNumber;
  } else if (typeof notificationDoc.title === 'string') {
    const match = notificationDoc.title.match(/\[(TCK-[A-Za-z0-9-]+)\]/i) ||
                  notificationDoc.title.match(/\b(TCK-[A-Za-z0-9-]+)\b/i);
    if (match) {
      payload.ticketNumber = match[1];
    }
  }

  return payload;
}

/**
 * Resolves the authorized Socket.IO recipient room.
 * - Active users join and receive via `user:<recipientId>`
 * - Suspended users receive via `official:<recipientId>`
 * Emits strictly to one room to prevent duplicate deliveries.
 */
export function resolveRecipientRoom(recipientId, accountStatus) {
  const idStr = recipientId?._id ? recipientId._id.toString() : recipientId?.toString();
  if (!idStr) return null;

  if (accountStatus === 'suspended') {
    return `official:${idStr}`;
  }
  return `user:${idStr}`;
}

/**
 * Delivers a single persisted notification to the intended recipient via Socket.IO.
 * Never throws to the caller, ensuring REST responses are not interrupted by delivery issues.
 *
 * @param {Object} notificationDoc - The persisted notification document
 * @param {Object} [options]
 * @param {string|ObjectId} [options.recipientId] - Explicit recipient ID override
 * @param {string} [options.accountStatus] - Recipient account status ('active' | 'suspended')
 * @param {boolean} [options.checkStatus] - If true, fetches accountStatus from DB if not provided
 * @returns {Promise<boolean>} True if successfully emitted
 */
export async function deliverNotification(notificationDoc, options = {}) {
  try {
    if (!notificationDoc) return false;

    const recipientId = options.recipientId || notificationDoc.recipient;
    if (!recipientId) return false;

    let accountStatus = options.accountStatus;
    if (!accountStatus && options.checkStatus) {
      try {
        const idToQuery = recipientId?._id || recipientId;
        const user = await UserProfile.findById(idToQuery).select('accountStatus').lean();
        accountStatus = user?.accountStatus;
      } catch (err) {
        console.warn('[NotificationService] Failed to query accountStatus, defaulting to active:', err?.message);
      }
    }

    const io = getIO();
    if (!io) {
      return false;
    }

    const room = resolveRecipientRoom(recipientId, accountStatus);
    if (!room) return false;

    const payload = formatNotificationPayload(notificationDoc);
    io.to(room).emit('notification:new', payload);
    return true;
  } catch (error) {
    console.error('[NotificationService] Failed to emit notification:new:', error);
    return false;
  }
}

/**
 * Delivers bulk persisted notifications to multiple recipients via Socket.IO.
 *
 * @param {Array<Object>} notificationDocs - Confirmed inserted notification documents
 * @param {Map<string, string>|Object} [recipientStatusMap] - Mapping of recipientId -> accountStatus
 * @returns {Promise<number>} Number of emitted notifications
 */
export async function deliverBulkNotifications(notificationDocs, recipientStatusMap = null) {
  try {
    if (!Array.isArray(notificationDocs) || notificationDocs.length === 0) {
      return 0;
    }

    const io = getIO();
    if (!io) {
      return 0;
    }

    let emittedCount = 0;
    for (const doc of notificationDocs) {
      try {
        const recipientId = doc?.recipient?._id ? doc.recipient._id.toString() : doc?.recipient?.toString();
        if (!recipientId) continue;

        const accountStatus = recipientStatusMap instanceof Map
          ? recipientStatusMap.get(recipientId)
          : recipientStatusMap?.[recipientId];

        const room = resolveRecipientRoom(recipientId, accountStatus);
        if (!room) continue;

        const payload = formatNotificationPayload(doc);
        io.to(room).emit('notification:new', payload);
        emittedCount++;
      } catch (recipientErr) {
        const recipientId = doc?.recipient?._id ? doc.recipient._id.toString() : doc?.recipient?.toString() || 'unknown';
        console.warn(`[NotificationService] Bulk delivery failed for recipient ${recipientId}: ${recipientErr?.message || recipientErr}`);
      }
    }

    return emittedCount;
  } catch (error) {
    console.error('[NotificationService] Bulk notification emission failed:', error?.message || error);
    return 0;
  }
}
