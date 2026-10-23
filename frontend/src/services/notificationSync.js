/**
 * notificationSync.js
 * Cross-tab synchronization utility for notification read events using localStorage.
 * Does NOT expose notification content (title, message, etc.) to other tabs or users.
 */

export const NOTIFICATION_SYNC_KEY = 'zync_notification_sync';

function getStorage() {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  if (typeof localStorage !== 'undefined') {
    return localStorage;
  }
  if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
    return globalThis.localStorage;
  }
  return null;
}

function dispatchCustomWindowEvent(eventName, detail) {
  const target = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null);
  if (!target || typeof target.dispatchEvent !== 'function') return;

  if (typeof CustomEvent === 'function') {
    target.dispatchEvent(new CustomEvent(eventName, { detail }));
  } else if (typeof Event === 'function') {
    const event = new Event(eventName);
    event.detail = detail;
    target.dispatchEvent(event);
  }
}

/**
 * Broadcasts a read action to other open tabs belonging to the same user.
 * @param {Object} params
 * @param {'read' | 'readAll'} params.type
 * @param {string} [params.id] - Notification ID when type === 'read'
 * @param {string} params.userId - Authenticated user ID
 */
export function broadcastNotificationAction({ type, id, userId, readAt }) {
  const storage = getStorage();
  if (!storage || !userId) return;

  try {
    const payload = {
      type,
      id: id || null,
      userId,
      readAt: readAt || null,
      _ts: Date.now()
    };
    storage.setItem(NOTIFICATION_SYNC_KEY, JSON.stringify(payload));
  } catch (e) {
    // Graceful fallback if localStorage is disabled or quota exceeded
  }
}

/**
 * Parses a storage event and dispatches the corresponding window event if matching the current user.
 * @param {StorageEvent} event
 * @param {string} currentUserId
 * @param {Object} [callbacks]
 * @param {Function} [callbacks.onRead]
 * @param {Function} [callbacks.onReadAll]
 */
export function handleNotificationStorageEvent(event, currentUserId, callbacks = {}) {
  if (!event || event.key !== NOTIFICATION_SYNC_KEY || !event.newValue) return;
  if (!currentUserId) return;

  try {
    const data = JSON.parse(event.newValue);
    if (!data || data.userId !== currentUserId) {
      return; // Do not expose or process actions across different users
    }

    if (data.type === 'read' && data.id) {
      if (typeof callbacks.onRead === 'function') {
        callbacks.onRead(data.id);
      }
      dispatchCustomWindowEvent('notificationRead', { id: data.id, crossTab: true });
    } else if (data.type === 'readAll') {
      if (typeof callbacks.onReadAll === 'function') {
        callbacks.onReadAll(data.readAt);
      }
      dispatchCustomWindowEvent('notificationsAllRead', { crossTab: true, readAt: data.readAt });
    }
  } catch (e) {
    // Ignore JSON parsing errors
  }
}

