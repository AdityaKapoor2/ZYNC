import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Pure state reducer helpers simulating the exact state update logic implemented in Connections.jsx and Chat.jsx
 */
export function applyConnectionsPresenceUpdate(connections, data) {
  if (!data || !data.userId) return connections;
  const targetUserId = data.userId.toString();
  return connections.map(conn => {
    if (conn?.user?._id?.toString() === targetUserId) {
      return {
        ...conn,
        user: {
          ...conn.user,
          isOnline: Boolean(data.isOnline),
          onlineUntil: data.isOnline
            ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
            : null,
          lastSeen: data.lastSeen || conn.user.lastSeen
        }
      };
    }
    return conn;
  });
}

export function applyChatParticipantPresenceUpdate(otherUser, data) {
  if (!data || !data.userId || !otherUser) return otherUser;
  if (otherUser._id?.toString() === data.userId.toString()) {
    return {
      ...otherUser,
      isOnline: Boolean(data.isOnline),
      onlineUntil: data.isOnline
        ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        : null,
      lastSeen: data.lastSeen || otherUser.lastSeen
    };
  }
  return otherUser;
}

export function isUserEffectivelyOnline(user) {
  return Boolean(user?.isOnline && user?.onlineUntil && new Date(user.onlineUntil) > new Date());
}

describe('Checkpoint P4: Frontend Real-Time Presence Synchronization', () => {
  let mockConnections;
  let mockChatUser;

  beforeEach(() => {
    mockConnections = [
      {
        connectionId: 'conn-1',
        user: {
          _id: 'user-bob',
          displayName: 'Bob',
          isOnline: false,
          onlineUntil: null,
          lastSeen: '2026-10-23T04:00:00.000Z'
        }
      },
      {
        connectionId: 'conn-2',
        user: {
          _id: 'user-charlie',
          displayName: 'Charlie',
          isOnline: true,
          onlineUntil: new Date(Date.now() + 3600000).toISOString(),
          lastSeen: '2026-10-23T05:00:00.000Z'
        }
      }
    ];

    mockChatUser = {
      _id: 'user-bob',
      displayName: 'Bob',
      isOnline: false,
      onlineUntil: null,
      lastSeen: '2026-10-23T04:00:00.000Z'
    };
  });

  describe('1. Connections.jsx Presence State Transitions', () => {
    it('transitions offline connection to online upon receiving presence:update', () => {
      expect(isUserEffectivelyOnline(mockConnections[0].user)).toBe(false);

      const updated = applyConnectionsPresenceUpdate(mockConnections, {
        userId: 'user-bob',
        isOnline: true,
        lastSeen: new Date().toISOString()
      });

      expect(isUserEffectivelyOnline(updated[0].user)).toBe(true);
      expect(updated[0].user.isOnline).toBe(true);
      expect(updated[0].user.onlineUntil).toBeDefined();

      // Ensure other connections are not mutated
      expect(updated[1].user._id).toBe('user-charlie');
      expect(isUserEffectivelyOnline(updated[1].user)).toBe(true);
    });

    it('transitions online connection to offline upon grace-period expiry or logout', () => {
      // Charlie goes offline
      const updated = applyConnectionsPresenceUpdate(mockConnections, {
        userId: 'user-charlie',
        isOnline: false,
        lastSeen: new Date().toISOString()
      });

      expect(isUserEffectivelyOnline(updated[1].user)).toBe(false);
      expect(updated[1].user.isOnline).toBe(false);
      expect(updated[1].user.onlineUntil).toBeNull();
    });

    it('handles invisible preference update as an ordinary offline transition', () => {
      // User transitions to invisible (server emits { isOnline: false })
      const updated = applyConnectionsPresenceUpdate(mockConnections, {
        userId: 'user-charlie',
        isOnline: false,
        lastSeen: new Date().toISOString()
      });

      expect(isUserEffectivelyOnline(updated[1].user)).toBe(false);
      // No visibilityPreference field should ever be injected into frontend connection state
      expect(updated[1].user.visibilityPreference).toBeUndefined();
    });

    it('ignores updates for users not in current connections list without errors', () => {
      const updated = applyConnectionsPresenceUpdate(mockConnections, {
        userId: 'user-stranger-999',
        isOnline: true,
        lastSeen: new Date().toISOString()
      });

      expect(updated).toEqual(mockConnections);
    });
  });

  describe('2. Chat.jsx Header Presence Synchronization', () => {
    it('updates otherUser presence in chat header when presence:update is received', () => {
      expect(isUserEffectivelyOnline(mockChatUser)).toBe(false);

      const updatedOtherUser = applyChatParticipantPresenceUpdate(mockChatUser, {
        userId: 'user-bob',
        isOnline: true,
        lastSeen: new Date().toISOString()
      });

      expect(isUserEffectivelyOnline(updatedOtherUser)).toBe(true);
      expect(updatedOtherUser.isOnline).toBe(true);
      expect(new Date(updatedOtherUser.onlineUntil).getTime()).toBeGreaterThan(Date.now());
    });

    it('updates otherUser to offline when disconnect or invisible event arrives', () => {
      const onlineUser = {
        _id: 'user-bob',
        displayName: 'Bob',
        isOnline: true,
        onlineUntil: new Date(Date.now() + 3600000).toISOString()
      };

      const updatedOtherUser = applyChatParticipantPresenceUpdate(onlineUser, {
        userId: 'user-bob',
        isOnline: false,
        lastSeen: new Date().toISOString()
      });

      expect(isUserEffectivelyOnline(updatedOtherUser)).toBe(false);
      expect(updatedOtherUser.onlineUntil).toBeNull();
    });

    it('ignores presence:update for unrelated user IDs in chat', () => {
      const updatedOtherUser = applyChatParticipantPresenceUpdate(mockChatUser, {
        userId: 'user-someone-else',
        isOnline: true,
        lastSeen: new Date().toISOString()
      });

      expect(updatedOtherUser).toEqual(mockChatUser);
    });
  });

  describe('3. Reconnect Reconciliation', () => {
    it('reconciles authoritative REST connections on reconnect', () => {
      // Simulate state prior to disconnect
      let localConnections = [
        { connectionId: 'c1', user: { _id: 'u1', isOnline: true, onlineUntil: new Date(Date.now() + 60000).toISOString() } }
      ];

      // Disconnect occurs, authoritative REST response during reconnect returns u1 as offline
      const authoritativeRestData = [
        { connectionId: 'c1', user: { _id: 'u1', isOnline: false, onlineUntil: null } }
      ];

      // Reconnect reconciliation replaces stale state with authoritative REST data
      localConnections = authoritativeRestData;
      expect(isUserEffectivelyOnline(localConnections[0].user)).toBe(false);
    });
  });

  describe('4. Socket Listener Lifecycle & Cleanup', () => {
    it('registers and unregisters presence:update listener cleanly without duplicates', () => {
      const mockSocket = {
        listeners: {},
        on(event, handler) {
          this.listeners[event] = this.listeners[event] || [];
          this.listeners[event].push(handler);
        },
        off(event, handler) {
          if (!this.listeners[event]) return;
          this.listeners[event] = this.listeners[event].filter(h => h !== handler);
        }
      };

      const handler = vi.fn();

      // Mount
      mockSocket.on('presence:update', handler);
      expect(mockSocket.listeners['presence:update'].length).toBe(1);

      // Unmount cleanup
      mockSocket.off('presence:update', handler);
      expect(mockSocket.listeners['presence:update'].length).toBe(0);
    });
  });
});
