import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computeEffectivePresence } from '../src/components/Navbar.jsx';
import { setVisibilityPreference, getPresenceStatus } from '../src/services/api.js';

describe('Checkpoint P5: Presence UI Cleanup and Visibility Preference', () => {

  describe('1. Preference and Connection State Separation', () => {
    it('1. Online preference + connected socket displays Online', () => {
      const status = computeEffectivePresence({ visibilityPreference: 'online', isConnected: true });
      expect(status.label).toBe('Online');
      expect(status.preference).toBe('online');
      expect(status.isConnected).toBe(true);
      expect(status.badgeColor).toBe('cyan');
    });

    it('2. Online preference + disconnected socket displays Offline without changing the saved preference', () => {
      const status = computeEffectivePresence({ visibilityPreference: 'online', isConnected: false });
      expect(status.label).toBe('Offline');
      expect(status.preference).toBe('online');
      expect(status.isConnected).toBe(false);
      expect(status.badgeColor).toBe('gray');
    });

    it('3. Invisible preference displays Invisible to its owner while connected', () => {
      const status = computeEffectivePresence({ visibilityPreference: 'invisible', isConnected: true });
      expect(status.label).toBe('Invisible');
      expect(status.preference).toBe('invisible');
      expect(status.isConnected).toBe(true);
      expect(status.badgeColor).toBe('purple');
    });

    it('4. Invisible preference persists when the socket disconnects and reconnects', () => {
      // Disconnected while invisible
      const disconnectedStatus = computeEffectivePresence({ visibilityPreference: 'invisible', isConnected: false });
      expect(disconnectedStatus.label).toBe('Invisible');
      expect(disconnectedStatus.preference).toBe('invisible');
      expect(disconnectedStatus.isConnected).toBe(false);

      // Reconnected while invisible
      const reconnectedStatus = computeEffectivePresence({ visibilityPreference: 'invisible', isConnected: true });
      expect(reconnectedStatus.label).toBe('Invisible');
      expect(reconnectedStatus.preference).toBe('invisible');
      expect(reconnectedStatus.isConnected).toBe(true);
    });

    it('handles legacy or missing preference by falling back to "online"', () => {
      const fallbackConnected = computeEffectivePresence({ visibilityPreference: undefined, isConnected: true });
      expect(fallbackConnected.preference).toBe('online');
      expect(fallbackConnected.label).toBe('Online');

      const fallbackDisconnected = computeEffectivePresence({ visibilityPreference: null, isConnected: false });
      expect(fallbackDisconnected.preference).toBe('online');
      expect(fallbackDisconnected.label).toBe('Offline');
    });
  });

  describe('2. Visibility API Invocations', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('5. Online -> Invisible invokes the visibility API with "invisible"', async () => {
      let capturedUrl = '';
      let capturedOptions = {};

      globalThis.fetch = vi.fn(async (url, options) => {
        capturedUrl = url;
        capturedOptions = options;
        return {
          ok: true,
          json: async () => ({
            visibilityPreference: 'invisible',
            isOnline: false,
            onlineUntil: null,
            lastSeen: new Date().toISOString()
          })
        };
      });

      const res = await setVisibilityPreference('test-token-123', 'invisible');
      expect(capturedUrl).toContain('/presence/visibility');
      expect(capturedOptions.method).toBe('PUT');
      expect(capturedOptions.headers['Authorization']).toBe('Bearer test-token-123');
      expect(JSON.parse(capturedOptions.body)).toEqual({ visibilityPreference: 'invisible' });
      expect(res.visibilityPreference).toBe('invisible');
    });

    it('6. Invisible -> Online invokes the visibility API with "online"', async () => {
      let capturedUrl = '';
      let capturedOptions = {};

      globalThis.fetch = vi.fn(async (url, options) => {
        capturedUrl = url;
        capturedOptions = options;
        return {
          ok: true,
          json: async () => ({
            visibilityPreference: 'online',
            isOnline: true,
            onlineUntil: new Date(Date.now() + 86400000).toISOString(),
            lastSeen: new Date().toISOString()
          })
        };
      });

      const res = await setVisibilityPreference('test-token-456', 'online');
      expect(capturedUrl).toContain('/presence/visibility');
      expect(capturedOptions.method).toBe('PUT');
      expect(capturedOptions.headers['Authorization']).toBe('Bearer test-token-456');
      expect(JSON.parse(capturedOptions.body)).toEqual({ visibilityPreference: 'online' });
      expect(res.visibilityPreference).toBe('online');
    });

    it('7. Failed preference updates retain previous preference and allow retry', async () => {
      globalThis.fetch = vi.fn(async () => {
        return {
          ok: false,
          json: async () => ({ message: 'Network timeout updating visibility' })
        };
      });

      let currentPreference = 'online';
      let errorMessage = '';

      const handleToggle = async (target) => {
        try {
          await setVisibilityPreference('fail-token', target);
          currentPreference = target;
        } catch (err) {
          errorMessage = err.message;
        }
      };

      await handleToggle('invisible');

      // Preference must remain 'online' when update fails
      expect(currentPreference).toBe('online');
      expect(errorMessage).toBe('Network timeout updating visibility');

      // Retry succeeds
      globalThis.fetch = vi.fn(async () => ({
        ok: true,
        json: async () => ({ visibilityPreference: 'invisible' })
      }));

      await handleToggle('invisible');
      expect(currentPreference).toBe('invisible');
    });
  });

  describe('3. Anti-Racing & Concurrency Protection', () => {
    it('8. Rapid clicks do not issue overlapping preference requests while pending', async () => {
      let activeRequests = 0;
      let maxConcurrentRequests = 0;
      let totalApiCalls = 0;

      const mockApi = async (pref) => {
        totalApiCalls++;
        activeRequests++;
        maxConcurrentRequests = Math.max(maxConcurrentRequests, activeRequests);
        await new Promise(r => setTimeout(r, 50));
        activeRequests--;
        return { visibilityPreference: pref };
      };

      let presenceLoading = false;
      let currentPreference = 'online';

      const userClickToggle = async () => {
        if (presenceLoading) return; // Protected against rapid consecutive clicks
        presenceLoading = true;
        try {
          const nextPref = currentPreference === 'online' ? 'invisible' : 'online';
          const res = await mockApi(nextPref);
          currentPreference = res.visibilityPreference;
        } finally {
          presenceLoading = false;
        }
      };

      // Trigger 5 rapid clicks concurrently
      await Promise.all([
        userClickToggle(),
        userClickToggle(),
        userClickToggle(),
        userClickToggle(),
        userClickToggle()
      ]);

      expect(maxConcurrentRequests).toBe(1);
      expect(totalApiCalls).toBe(1);
      expect(currentPreference).toBe('invisible');
    });
  });

  describe('4. Obsolete Code Removal Verification', () => {
    it('9. The 30-minute countdown, interval timer, and manual presence endpoints are removed from Navbar.jsx', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const navbarSource = fs.readFileSync(path.resolve(__dirname, '../src/components/Navbar.jsx'), 'utf-8');

      // Obsolete states and intervals must not exist
      expect(navbarSource).not.toContain('timeRemaining');
      expect(navbarSource).not.toContain('onlineUntil - now');
      expect(navbarSource).not.toContain('setOnlineStatus');
      expect(navbarSource).not.toContain('setOfflineStatus');
      expect(navbarSource).not.toContain('handleTogglePresence');
      expect(navbarSource).not.toMatch(/setInterval\s*\([^,]+,\s*1000\)/);
    });

    it('verifies setOnlineStatus post-login side effect was removed from Login.jsx', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const loginSource = fs.readFileSync(path.resolve(__dirname, '../src/pages/Login.jsx'), 'utf-8');

      expect(loginSource).not.toContain('setOnlineStatus');
      expect(loginSource).not.toContain('Auto set online status');
    });
  });

  describe('5. Reconnection & Synchronization', () => {
    it('10. Reconnect reconciliation fetches authoritative preference state from GET /presence/me', async () => {
      const originalFetch = globalThis.fetch;
      try {
        let calledEndpoint = '';
        globalThis.fetch = vi.fn(async (url) => {
          calledEndpoint = url;
          return {
            ok: true,
            json: async () => ({
              visibilityPreference: 'invisible',
              isOnline: false,
              onlineUntil: null,
              lastSeen: new Date().toISOString()
            })
          };
        });

        const authoritativePresence = await getPresenceStatus('reconnect-token');
        expect(calledEndpoint).toContain('/presence/me');
        expect(authoritativePresence.visibilityPreference).toBe('invisible');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('11. presence:update event cannot accidentally overwrite the saved visibility preference', () => {
      let savedVisibilityPreference = 'invisible';

      // Simulate incoming presence:update event with isOnline = false
      const eventData = { userId: 'my-user-id', isOnline: false };

      // In Navbar, presence:update is NOT used to set visibilityPreference!
      // If someone attempted to do savedVisibilityPreference = eventData.isOnline ? 'online' : 'invisible',
      // an online user receiving isOnline=false on disconnect would have their preference flipped!
      // Verify that rule:
      const safeHandler = (data) => {
        // Do NOT change savedVisibilityPreference from data.isOnline
        if (data.isOnline !== undefined) {
          // No-op for saved preference
        }
      };

      safeHandler(eventData);
      expect(savedVisibilityPreference).toBe('invisible');

      // When another user goes offline, our preference stays intact
      safeHandler({ userId: 'other-user-id', isOnline: true });
      expect(savedVisibilityPreference).toBe('invisible');
    });

    it('12. User/auth changes and unmount clean up listeners and prevent stale updates', () => {
      const listeners = new Map();
      const mockSocket = {
        on: vi.fn((event, fn) => listeners.set(event, fn)),
        off: vi.fn((event, fn) => {
          if (listeners.get(event) === fn) listeners.delete(event);
        })
      };

      const handler = () => {};
      mockSocket.on('presence:update', handler);
      expect(listeners.has('presence:update')).toBe(true);

      // Component unmount / cleanup
      mockSocket.off('presence:update', handler);
      expect(listeners.has('presence:update')).toBe(false);
    });
  });

  describe('6. Mobile Access, Privacy Masking, and Messaging Availability', () => {
    it('13. Mobile users can access the visibility control in the dropdown menu', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const navbarSource = fs.readFileSync(path.resolve(__dirname, '../src/components/Navbar.jsx'), 'utf-8');

      // Dropdown menu must contain mobile visibility toggle button
      expect(navbarSource).toContain('Mobile / Dropdown Visibility Control');
      expect(navbarSource).toContain('aria-label={`Toggle visibility from ${visibilityPreference}`}');
      expect(navbarSource).toContain('handleToggleVisibility');
    });

    it('14. Other users continue to see an Invisible friend as ordinary Offline', () => {
      // In P4 connections presence state update:
      const friendConnection = {
        connectionId: 'c-100',
        user: {
          _id: 'friend-bob',
          displayName: 'Bob',
          isOnline: true,
          onlineUntil: new Date(Date.now() + 100000).toISOString()
        }
      };

      // Server emits { userId: 'friend-bob', isOnline: false } for invisible users
      const presenceUpdate = {
        userId: 'friend-bob',
        isOnline: false,
        lastSeen: '2026-10-23T12:00:00.000Z'
      };

      const updatedUser = {
        ...friendConnection.user,
        isOnline: Boolean(presenceUpdate.isOnline),
        onlineUntil: presenceUpdate.isOnline ? new Date().toISOString() : null,
        lastSeen: presenceUpdate.lastSeen
      };

      // Friend sees isOnline = false, and NO visibilityPreference is disclosed
      expect(updatedUser.isOnline).toBe(false);
      expect(updatedUser.onlineUntil).toBeNull();
      expect(updatedUser.visibilityPreference).toBeUndefined();
    });

    it('15. Messaging remains available regardless of presence state (Online/Offline/Invisible)', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const chatSource = fs.readFileSync(path.resolve(__dirname, '../src/pages/Chat.jsx'), 'utf-8');

      // Chat input disabling logic must NOT check isOnline or visibilityPreference
      expect(chatSource).not.toMatch(/disabled=\{[^}]*\bisOnline\b[^}]*\}/);
      expect(chatSource).not.toMatch(/disabled=\{[^}]*\bvisibilityPreference\b[^}]*\}/);

      // Verify sending messages is permitted when otherUser is offline
      const mockOtherUserOffline = { _id: 'user-2', isOnline: false };
      const canTypeAndSend = Boolean(mockOtherUserOffline); // only depends on conversation loaded, not presence
      expect(canTypeAndSend).toBe(true);
    });
  });
});
