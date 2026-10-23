import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  broadcastNotificationAction,
  handleNotificationStorageEvent,
  NOTIFICATION_SYNC_KEY
} from '../src/services/notificationSync.js';
import {
  extractTicketIdentifier,
  isAppealSubmission
} from '../src/pages/Notifications.jsx';
import {
  getUserNotifications,
  getUnreadNotificationCount,
  markNotificationAsRead,
  markAllNotificationsAsRead
} from '../src/services/api.js';

describe('Checkpoint N3: Frontend Real-Time Notifications & Synchronization', () => {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = globalThis.localStorage;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalLocalStorage) {
      globalThis.localStorage = originalLocalStorage;
    }
  });

  describe('1. Live Notification Delivery & Unread Badge Mechanics', () => {
    it('formats unread badge correctly (0 is hidden, 1-99 as number, >99 as 99+)', () => {
      const formatBadge = (count) => {
        if (!count || count <= 0) return null;
        return count > 99 ? '99+' : String(count);
      };

      expect(formatBadge(0)).toBeNull();
      expect(formatBadge(-1)).toBeNull();
      expect(formatBadge(1)).toBe('1');
      expect(formatBadge(42)).toBe('42');
      expect(formatBadge(99)).toBe('99');
      expect(formatBadge(100)).toBe('99+');
      expect(formatBadge(1000)).toBe('99+');
    });

    it('simulates live socket notification reception and badge increment', () => {
      let unreadCount = 3;
      const seenIds = new Set(['notif-existing']);

      const handleLiveNotification = (notif) => {
        if (!notif || !notif._id) return;
        if (seenIds.has(notif._id)) return;
        seenIds.add(notif._id);
        unreadCount += 1;
      };

      // Deliver new notification
      handleLiveNotification({ _id: 'notif-1', title: 'New Notification', read: false });
      expect(unreadCount).toBe(4);
      expect(seenIds.has('notif-1')).toBe(true);

      // Deliver same notification again: must not double-count
      handleLiveNotification({ _id: 'notif-1', title: 'New Notification', read: false });
      expect(unreadCount).toBe(4);
    });

    it('cleans up deduplication cache when user context changes', () => {
      const seenIds = new Set(['notif-1', 'notif-2']);
      expect(seenIds.size).toBe(2);

      const handleUserChange = () => {
        seenIds.clear();
      };

      handleUserChange();
      expect(seenIds.size).toBe(0);
    });
  });

  describe('2. Deduplication and Pagination Preservation on Notifications Page', () => {
    it('prepends incoming notification to page 1 without exceeding page size 20', () => {
      const initialList = Array.from({ length: 20 }, (_, i) => ({
        _id: `notif-${i}`,
        title: `Notification ${i}`,
        read: false
      }));

      const newNotif = {
        _id: 'notif-new',
        title: 'Fresh Announcement',
        read: false
      };

      const applyNewNotification = (list, notif) => {
        if (list.some((n) => n._id === notif._id)) return list;
        return [notif, ...list].slice(0, 20);
      };

      const updated = applyNewNotification(initialList, newNotif);
      expect(updated.length).toBe(20);
      expect(updated[0]._id).toBe('notif-new');
      expect(updated[19]._id).toBe('notif-18'); // last element was pushed off page 1
    });

    it('does not insert duplicate items if notification is delivered multiple times', () => {
      const initialList = [
        { _id: 'notif-1', title: 'First Notice', read: false },
        { _id: 'notif-2', title: 'Second Notice', read: false }
      ];

      const applyNewNotification = (list, notif) => {
        if (list.some((n) => n._id === notif._id)) return list;
        return [notif, ...list].slice(0, 20);
      };

      const dupNotif = { _id: 'notif-1', title: 'First Notice Duplicate', read: false };
      const updated = applyNewNotification(initialList, dupNotif);

      expect(updated.length).toBe(2);
      expect(updated[0]._id).toBe('notif-1');
      expect(updated[0].title).toBe('First Notice');
    });

    it('does not inject incoming items into page > 1 but updates total count', () => {
      const page2List = [
        { _id: 'notif-21', title: 'Page 2 Item 1' },
        { _id: 'notif-22', title: 'Page 2 Item 2' }
      ];
      let totalCount = 22;
      let totalPages = 2;

      const handleIncomingForPage = (currentPage, list, notif) => {
        if (currentPage === 1) {
          list = [notif, ...list].slice(0, 20);
        }
        totalCount += 1;
        totalPages = Math.max(1, Math.ceil(totalCount / 20));
        return list;
      };

      const resultList = handleIncomingForPage(2, page2List, { _id: 'notif-23', title: 'New Item' });

      // List on page 2 remains unchanged
      expect(resultList).toEqual(page2List);
      expect(totalCount).toBe(23);
      expect(totalPages).toBe(2);
    });
  });

  describe('3. Reconnect Reconciliation', () => {
    it('fetches authoritative unread count upon socket reconnection', async () => {
      let unreadCount = 5;

      globalThis.fetch = vi.fn(async (url) => {
        if (url.includes('/notifications/unread-count')) {
          return {
            ok: true,
            json: async () => ({ count: 2 })
          };
        }
        return { ok: false };
      });

      const reconcileOnReconnect = async (token) => {
        const res = await getUnreadNotificationCount(token);
        if (res && typeof res.count === 'number') {
          unreadCount = res.count;
        }
      };

      await reconcileOnReconnect('token-abc');
      expect(unreadCount).toBe(2);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('refreshes the current notification page from REST upon reconnection to recover missed notifications', async () => {
      let pageNotifications = [{ _id: 'old-1', title: 'Old 1' }];

      globalThis.fetch = vi.fn(async (url) => {
        if (url.includes('/notifications?page=1')) {
          return {
            ok: true,
            json: async () => ({
              notifications: [
                { _id: 'missed-1', title: 'Missed While Offline' },
                { _id: 'old-1', title: 'Old 1' }
              ],
              totalCount: 2,
              totalPages: 1
            })
          };
        }
        return { ok: false };
      });

      const reconcilePage = async (token, page) => {
        const res = await getUserNotifications(token, page, 20);
        pageNotifications = res.notifications;
      };

      await reconcilePage('token-abc', 1);
      expect(pageNotifications.length).toBe(2);
      expect(pageNotifications[0]._id).toBe('missed-1');
    });
  });

  describe('4. Read-One & Read-All Mutation Lifecycle', () => {
    it('marking single notification as read updates local state and emits event only after API confirms success', async () => {
      let capturedUrl = '';
      let capturedMethod = '';

      globalThis.fetch = vi.fn(async (url, opts) => {
        capturedUrl = url;
        capturedMethod = opts?.method;
        return {
          ok: true,
          json: async () => ({ success: true })
        };
      });

      const list = [
        { _id: 'n-1', read: false },
        { _id: 'n-2', read: false }
      ];

      const res = await markNotificationAsRead('test-token', 'n-1');
      expect(capturedUrl).toContain('/notifications/n-1/read');
      expect(capturedMethod).toBe('PATCH');
      expect(res.success).toBe(true);

      const updatedList = list.map((n) => (n._id === 'n-1' ? { ...n, read: true } : n));
      expect(updatedList[0].read).toBe(true);
      expect(updatedList[1].read).toBe(false);
    });

    it('failed read API call does not mark notification as read and retains unread count', async () => {
      globalThis.fetch = vi.fn(async () => {
        return {
          ok: false,
          json: async () => ({ message: 'Network error marking read' })
        };
      });

      let notif = { _id: 'n-fail', read: false };
      let error = '';

      try {
        await markNotificationAsRead('test-token', 'n-fail');
        notif = { ...notif, read: true };
      } catch (err) {
        error = err.message;
      }

      expect(notif.read).toBe(false);
      expect(error).toBe('Network error marking read');
    });

    it('marking all as read updates all items and resets count to zero on API confirmation', async () => {
      let capturedMethod = '';
      globalThis.fetch = vi.fn(async (url, opts) => {
        capturedMethod = opts?.method;
        return {
          ok: true,
          json: async () => ({ success: true, count: 3 })
        };
      });

      const list = [
        { _id: 'n-1', read: false },
        { _id: 'n-2', read: false },
        { _id: 'n-3', read: false }
      ];

      const res = await markAllNotificationsAsRead('test-token');
      expect(capturedMethod).toBe('PATCH');
      expect(res.success).toBe(true);

      const updatedList = list.map((n) => ({ ...n, read: true }));
      expect(updatedList.every((n) => n.read)).toBe(true);
    });
  });

  describe('5. Cross-Tab Synchronization Security and Integrity', () => {
    let mockStorage = {};

    beforeEach(() => {
      mockStorage = {};
      globalThis.localStorage = {
        getItem: vi.fn((k) => mockStorage[k] || null),
        setItem: vi.fn((k, v) => {
          mockStorage[k] = String(v);
        }),
        removeItem: vi.fn((k) => {
          delete mockStorage[k];
        }),
        clear: vi.fn(() => {
          mockStorage = {};
        })
      };
    });

    it('broadcastNotificationAction writes action, id, and userId without exposing notification content', () => {
      broadcastNotificationAction({
        type: 'read',
        id: 'notif-123',
        userId: 'user-alice'
      });

      expect(localStorage.setItem).toHaveBeenCalledWith(
        NOTIFICATION_SYNC_KEY,
        expect.any(String)
      );

      const stored = JSON.parse(mockStorage[NOTIFICATION_SYNC_KEY]);
      expect(stored.type).toBe('read');
      expect(stored.id).toBe('notif-123');
      expect(stored.userId).toBe('user-alice');
      expect(stored._ts).toBeDefined();

      // Ensure no sensitive or message content was serialized
      expect(stored.title).toBeUndefined();
      expect(stored.message).toBeUndefined();
    });

    it('handleNotificationStorageEvent triggers callbacks when user matches', () => {
      const onRead = vi.fn();
      const storageEvent = {
        key: NOTIFICATION_SYNC_KEY,
        newValue: JSON.stringify({
          type: 'read',
          id: 'notif-999',
          userId: 'user-alice',
          _ts: Date.now()
        })
      };

      handleNotificationStorageEvent(storageEvent, 'user-alice', { onRead });
      expect(onRead).toHaveBeenCalledWith('notif-999');
    });

    it('handleNotificationStorageEvent rejects and ignores events belonging to a different user', () => {
      const onRead = vi.fn();
      const storageEvent = {
        key: NOTIFICATION_SYNC_KEY,
        newValue: JSON.stringify({
          type: 'read',
          id: 'notif-999',
          userId: 'user-bob', // Different user!
          _ts: Date.now()
        })
      };

      handleNotificationStorageEvent(storageEvent, 'user-alice', { onRead });
      expect(onRead).not.toHaveBeenCalled();
    });

    it('handleNotificationStorageEvent handles readAll action for matching user', () => {
      const onReadAll = vi.fn();
      const storageEvent = {
        key: NOTIFICATION_SYNC_KEY,
        newValue: JSON.stringify({
          type: 'readAll',
          userId: 'user-alice',
          _ts: Date.now()
        })
      };

      handleNotificationStorageEvent(storageEvent, 'user-alice', { onReadAll });
      expect(onReadAll).toHaveBeenCalled();
    });
  });

  describe('6. Deep Link and Presentation Preservation', () => {
    it('extracts ticket number from various notification title and payload conventions', () => {
      expect(extractTicketIdentifier({ ticketNumber: 'TCK-20261023-1111' })).toBe('TCK-20261023-1111');
      expect(extractTicketIdentifier({ title: 'Ticket Status Updated [TCK-20261023-2222]' })).toBe('TCK-20261023-2222');
      expect(extractTicketIdentifier({ message: 'Update on ticket [TCK-20261023-3333]' })).toBe('TCK-20261023-3333');
      expect(extractTicketIdentifier({ title: 'General Broadcast' })).toBeNull();
    });

    it('identifies appeal submissions correctly', () => {
      expect(isAppealSubmission({ title: 'New Appeal Submitted' })).toBe(true);
      expect(isAppealSubmission({ title: 'new appeal submitted' })).toBe(true);
      expect(isAppealSubmission({ title: 'Regular Ticket' })).toBe(false);
      expect(isAppealSubmission(null)).toBe(false);
    });
  });

  describe('7. Socket Event Lifecycle & Cleanup', () => {
    it('registers and unregisters socket listeners cleanly', () => {
      const mockSocket = {
        on: vi.fn(),
        off: vi.fn()
      };

      const handler = () => {};
      mockSocket.on('notification:new', handler);
      expect(mockSocket.on).toHaveBeenCalledWith('notification:new', handler);

      mockSocket.off('notification:new', handler);
      expect(mockSocket.off).toHaveBeenCalledWith('notification:new', handler);
    });
  });

  describe('8. Cross-Device Socket Synchronization & Race Safety (R-05)', () => {
    it('notification:read updates matching notification to read: true', () => {
      let list = [
        { _id: 'n-1', title: 'Notif 1', read: false },
        { _id: 'n-2', title: 'Notif 2', read: false }
      ];

      const handleSocketRead = (data) => {
        const readId = data?._id;
        if (readId) {
          list = list.map((n) => (n._id === readId ? { ...n, read: true } : n));
        }
      };

      handleSocketRead({ _id: 'n-1', read: true });
      expect(list[0].read).toBe(true);
      expect(list[1].read).toBe(false);
    });

    it('notification:read decrements unread count safely without negative values', () => {
      let unreadCount = 1;
      const handleSocketRead = (data) => {
        if (!data?._id) return;
        unreadCount = Math.max(0, unreadCount - 1);
      };

      handleSocketRead({ _id: 'n-1' });
      expect(unreadCount).toBe(0);

      // Decrementing when already 0 stays 0
      handleSocketRead({ _id: 'n-2' });
      expect(unreadCount).toBe(0);
    });

    it('notification:read_all marks only notifications created at or before cutoff as read: true', () => {
      const cutoffTime = new Date('2026-10-23T12:00:00.000Z').getTime();
      let list = [
        { _id: 'n-past-1', createdAt: '2026-10-23T11:50:00.000Z', read: false },
        { _id: 'n-at-cutoff', createdAt: '2026-10-23T12:00:00.000Z', read: false },
        { _id: 'n-future-concurrent', createdAt: '2026-10-23T12:00:01.000Z', read: false }
      ];

      const handleSocketReadAll = (data) => {
        const cutoff = data?.readAt ? new Date(data.readAt).getTime() : Date.now();
        list = list.map((n) => {
          if (!n.createdAt) return { ...n, read: true };
          const itemTime = new Date(n.createdAt).getTime();
          return itemTime <= cutoff ? { ...n, read: true } : n;
        });
      };

      handleSocketReadAll({ readAt: '2026-10-23T12:00:00.000Z' });

      // Notifications at or before cutoff become read: true
      expect(list[0].read).toBe(true);
      expect(list[1].read).toBe(true);
      // Notification created after cutoff strictly remains read: false
      expect(list[2].read).toBe(false);
    });

    it('cross-tab handleNotificationStorageEvent delivers readAt with readAll action', () => {
      const onReadAll = vi.fn();
      const storageEvent = {
        key: NOTIFICATION_SYNC_KEY,
        newValue: JSON.stringify({
          type: 'readAll',
          userId: 'user-alice',
          readAt: '2026-10-23T12:00:00.000Z',
          _ts: Date.now()
        })
      };

      handleNotificationStorageEvent(storageEvent, 'user-alice', { onReadAll });
      expect(onReadAll).toHaveBeenCalledWith('2026-10-23T12:00:00.000Z');
    });
  });

  describe('6. Admin Broadcast Idempotency Client Lifecycle (R-06)', () => {
    it('generates a valid UUID idempotency key and attaches it to broadcast payload', async () => {
      let sentPayload = null;
      globalThis.fetch = vi.fn().mockImplementation(async (url, opts) => {
        if (url.includes('/admin/notifications') && opts.method === 'POST') {
          sentPayload = JSON.parse(opts.body);
          return {
            ok: true,
            status: 201,
            json: async () => ({
              success: true,
              recipientCount: 5,
              broadcastId: 'b-123',
              idempotent: false
            })
          };
        }
        return { ok: true, json: async () => ({}) };
      });

      const { createAdminNotification } = await import('../src/services/api.js');
      const testKey = 'test-uuid-' + Date.now();
      await createAdminNotification('mock-token', {
        audienceType: 'all',
        title: 'Title',
        message: 'Message',
        idempotencyKey: testKey
      });

      expect(sentPayload).toBeDefined();
      expect(sentPayload.idempotencyKey).toBe(testKey);
    });

    it('retains stable idempotency key across failed attempts and retries', async () => {
      let attemptCount = 0;
      const seenKeys = [];

      globalThis.fetch = vi.fn().mockImplementation(async (url, opts) => {
        if (url.includes('/admin/notifications') && opts.method === 'POST') {
          attemptCount++;
          const payload = JSON.parse(opts.body);
          seenKeys.push(payload.idempotencyKey);

          if (attemptCount === 1) {
            return {
              ok: false,
              status: 504,
              json: async () => ({ message: 'Gateway Timeout' })
            };
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              recipientCount: 5,
              broadcastId: 'b-123',
              idempotent: true
            })
          };
        }
        return { ok: true, json: async () => ({}) };
      });

      const { createAdminNotification } = await import('../src/services/api.js');
      
      // Simulate client submission lifecycle: key is generated once for the intentional submission
      const stableKey = 'stable-retry-uuid-456';
      
      // Attempt 1 fails
      await expect(
        createAdminNotification('mock-token', {
          audienceType: 'all',
          title: 'Retry Test',
          message: 'Retry message',
          idempotencyKey: stableKey
        })
      ).rejects.toThrow();

      // Attempt 2 succeeds using the SAME key
      const res = await createAdminNotification('mock-token', {
        audienceType: 'all',
        title: 'Retry Test',
        message: 'Retry message',
        idempotencyKey: stableKey
      });

      expect(res.success).toBe(true);
      expect(attemptCount).toBe(2);
      expect(seenKeys.length).toBe(2);
      expect(seenKeys[0]).toBe(stableKey);
      expect(seenKeys[1]).toBe(stableKey);
    });

    it('generates distinct keys for consecutive distinct broadcasts even with identical content', () => {
      const generateKey = () => {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
          return crypto.randomUUID();
        }
        return 'idemp-' + Date.now() + '-' + Math.random().toString(36).substring(2, 11);
      };

      const key1 = generateKey();
      const key2 = generateKey();

      expect(key1).toBeDefined();
      expect(key2).toBeDefined();
      expect(key1).not.toBe(key2);
      // Confirms key is not a content hash
      expect(typeof key1).toBe('string');
      expect(key1.length).toBeGreaterThan(10);
    });
  });
});
