import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import { io as ioClient } from 'socket.io-client';
import express from 'express';
import { connectTestDB, closeTestDB } from './setup.js';
import UserProfile from '../src/models/UserProfile.js';
import {
  initSocket,
  getIO,
  _resetIO,
  _resetRateLimiter,
  resolveClientIp,
  checkRateLimit
} from '../src/config/socket.js';
import { syncSocketRooms, getDesiredRooms } from '../src/services/socketService.js';
import { updateUserStatus } from '../src/controllers/adminController.js';
import { createApp } from '../src/app.js';
import { validateTrustProxy } from '../src/config/proxy.js';

// Mock Firebase Admin token verification
vi.mock('../src/config/firebase-admin.js', () => ({
  default: {
    auth: () => ({
      verifyIdToken: async (token) => {
        if (token === 'valid_active_token') {
          return { uid: 'socket-test-active-uid', email: 'socket-test-active@zync.test' };
        }
        if (token === 'valid_admin_token') {
          return { uid: 'socket-test-admin-uid', email: 'socket-test-admin@zync.test' };
        }
        if (token === 'valid_suspended_token') {
          return { uid: 'socket-test-suspended-uid', email: 'socket-test-suspended@zync.test' };
        }
        if (token === 'valid_no_profile_token') {
          return { uid: 'socket-test-no-profile-uid', email: 'socket-test-no-profile@zync.test' };
        }
        if (token.startsWith('socket-test-token-')) {
          const uid = token.replace('socket-test-token-', 'socket-test-');
          return { uid, email: `${uid}@zync.test` };
        }
        throw new Error('Firebase ID token is invalid or expired');
      }
    })
  }
}));

describe('Phase 1: Socket.IO Real-Time Infrastructure Integration Tests', () => {
  let server;
  let port;
  let ioServer;
  const activeClients = new Set();

  let activeUserProfile;
  let adminUserProfile;
  let suspendedUserProfile;

  const allowedOrigins = ['http://localhost:5173', 'https://zync-app.vercel.app'];

  function createClient(options = {}) {
    const defaultOptions = {
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: false,
      autoConnect: false,
      timeout: 5000
    };
    const client = ioClient(`http://127.0.0.1:${port}`, {
      ...defaultOptions,
      ...options
    });
    activeClients.add(client);
    return client;
  }

  function waitForConnect(client) {
    return new Promise((resolve, reject) => {
      client.once('connect', () => resolve(client));
      client.once('connect_error', (err) => reject(err));
      client.connect();
    });
  }

  function waitForConnectError(client) {
    return new Promise((resolve) => {
      client.once('connect_error', (err) => resolve(err));
      client.once('connect', () => resolve(new Error('Unexpectedly connected')));
      client.connect();
    });
  }

  async function waitForRoom(serverSocket, room, shouldHave = true) {
    for (let i = 0; i < 40; i++) {
      if (serverSocket.rooms.has(room) === shouldHave) {
        return true;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    return serverSocket.rooms.has(room);
  }

  beforeAll(async () => {
    await connectTestDB();

    const app = express();
    server = http.createServer(app);

    ioServer = initSocket(server, {
      trustProxy: 1,
      allowedOrigins
    });

    await new Promise((resolve) => server.listen(0, resolve));
    port = server.address().port;
  });

  afterAll(async () => {
    for (const client of activeClients) {
      if (client.connected || client.connecting) {
        client.disconnect();
      }
    }
    activeClients.clear();

    if (ioServer) {
      ioServer.disconnectSockets(true);
      await new Promise((resolve) => ioServer.close(resolve));
      _resetIO();
    }

    await closeTestDB();
  });

  beforeEach(async () => {
    _resetRateLimiter();
    await UserProfile.deleteMany({ firebaseUid: /^socket-test-/ });

    activeUserProfile = await UserProfile.create({
      firebaseUid: 'socket-test-active-uid',
      displayName: 'Active Socket Tester',
      email: 'socket-test-active@zync.test',
      role: 'user',
      accountStatus: 'active',
      games: [{ gameName: 'Valorant', inGameName: 'ActiveTester', skillLevel: 50 }]
    });

    adminUserProfile = await UserProfile.create({
      firebaseUid: 'socket-test-admin-uid',
      displayName: 'Admin Socket Tester',
      email: 'socket-test-admin@zync.test',
      role: 'super_admin',
      accountStatus: 'active',
      games: [{ gameName: 'Valorant', inGameName: 'AdminTester', skillLevel: 90 }]
    });

    suspendedUserProfile = await UserProfile.create({
      firebaseUid: 'socket-test-suspended-uid',
      displayName: 'Suspended Socket Tester',
      email: 'socket-test-suspended@zync.test',
      role: 'user',
      accountStatus: 'suspended',
      games: [{ gameName: 'BGMI', inGameName: 'SuspendedTester', skillLevel: 10 }]
    });
  });

  afterEach(() => {
    for (const client of activeClients) {
      if (client.connected || client.connecting) {
        client.disconnect();
      }
    }
    activeClients.clear();
  });

  // =========================================================================
  // 1. Handshake Rate Limiting (4 tests)
  // =========================================================================
  describe('1. Handshake Rate Limiting', () => {
    it('permits up to 60 connections within a 1-minute window', () => {
      const ip = '198.51.100.1';
      for (let i = 0; i < 60; i++) {
        expect(checkRateLimit(ip)).toBe(true);
      }
    });

    it('rejects the 61st connection attempt with RATE_LIMIT_EXCEEDED', async () => {
      const ip = '198.51.100.2';
      for (let i = 0; i < 60; i++) {
        checkRateLimit(ip);
      }
      expect(checkRateLimit(ip)).toBe(false);

      const client = createClient({
        transports: ['polling'],
        auth: { token: 'valid_active_token' },
        extraHeaders: {
          'x-forwarded-for': ip
        }
      });

      const err = await waitForConnectError(client);
      expect(err.message).toBe('RATE_LIMIT_EXCEEDED');
      expect(err.data?.code).toBe('RATE_LIMIT_EXCEEDED');
    });

    it('resets window after expiry allowing subsequent connections', () => {
      const ip = '198.51.100.3';
      for (let i = 0; i < 60; i++) {
        checkRateLimit(ip);
      }
      expect(checkRateLimit(ip)).toBe(false);

      // Reset rate limiter (simulating expiry)
      _resetRateLimiter();
      expect(checkRateLimit(ip)).toBe(true);
    });

    it('tracks distinct client IPs independently in separate rate buckets', () => {
      const ipA = '198.51.100.10';
      const ipB = '198.51.100.20';

      for (let i = 0; i < 60; i++) {
        checkRateLimit(ipA);
      }
      expect(checkRateLimit(ipA)).toBe(false);
      expect(checkRateLimit(ipB)).toBe(true);
    });
  });

  // =========================================================================
  // 2. Client IP & Trusted Proxy Resolution (6 tests)
  // =========================================================================
  describe('2. Client IP & Trusted Proxy Resolution', () => {
    it('returns direct TCP socket peer address when trustProxy = 0 / "0" / false / "false"', () => {
      const handshake = {
        address: '10.0.0.1',
        headers: { 'x-forwarded-for': '203.0.113.5' }
      };
      expect(resolveClientIp(handshake, 0)).toBe('10.0.0.1');
      expect(resolveClientIp(handshake, '0')).toBe('10.0.0.1');
      expect(resolveClientIp(handshake, false)).toBe('10.0.0.1');
      expect(resolveClientIp(handshake, 'false')).toBe('10.0.0.1');
    });

    it('defaults to 1 when trustProxy is unset (undefined, null, or empty string)', () => {
      const handshake = {
        address: '10.0.0.1',
        headers: { 'x-forwarded-for': '203.0.113.5' }
      };
      expect(resolveClientIp(handshake, undefined)).toBe('203.0.113.5');
      expect(resolveClientIp(handshake, null)).toBe('203.0.113.5');
      expect(resolveClientIp(handshake, '')).toBe('203.0.113.5');
    });

    it('resolves correct client IP with trustProxy = 1 (single reverse proxy)', () => {
      const handshake = {
        address: '10.0.0.1',
        headers: { 'x-forwarded-for': '203.0.113.195' }
      };
      expect(resolveClientIp(handshake, 1)).toBe('203.0.113.195');
      expect(resolveClientIp(handshake, '1')).toBe('203.0.113.195');
    });

    it('resolves correct client IP with trustProxy = 2 (multi-tier reverse proxy)', () => {
      const handshake = {
        address: '10.0.0.1',
        headers: { 'x-forwarded-for': '198.51.100.42, 192.0.2.1' }
      };
      expect(resolveClientIp(handshake, 2)).toBe('198.51.100.42');
      expect(resolveClientIp(handshake, '2')).toBe('198.51.100.42');
    });

    it('rejects malformed, negative, fractional, and unsupported configurations with clear error', () => {
      const handshake = {
        address: '10.0.0.1',
        headers: { 'x-forwarded-for': '203.0.113.5' }
      };

      expect(() => resolveClientIp(handshake, '-1')).toThrow(/Invalid TRUST_PROXY configuration/);
      expect(() => resolveClientIp(handshake, -1)).toThrow(/Invalid TRUST_PROXY configuration/);
      expect(() => resolveClientIp(handshake, '1.5')).toThrow(/Invalid TRUST_PROXY configuration/);
      expect(() => resolveClientIp(handshake, 1.5)).toThrow(/Invalid TRUST_PROXY configuration/);
      expect(() => resolveClientIp(handshake, 'abc')).toThrow(/Invalid TRUST_PROXY configuration/);
      expect(() => resolveClientIp(handshake, 'true')).toThrow(/Invalid TRUST_PROXY configuration/);
      expect(() => resolveClientIp(handshake, true)).toThrow(/Invalid TRUST_PROXY configuration/);
    });

    it('ensures Express createApp and Socket.IO use the exact same validated trust proxy setting', () => {
      const appZero = createApp(null, 0);
      expect(appZero.get('trust proxy')).toBe(0);

      const appZeroStr = createApp(null, '0');
      expect(appZeroStr.get('trust proxy')).toBe(0);

      const appFalse = createApp(null, false);
      expect(appFalse.get('trust proxy')).toBe(0);

      const appFalseStr = createApp(null, 'false');
      expect(appFalseStr.get('trust proxy')).toBe(0);

      const appDefault = createApp();
      expect(appDefault.get('trust proxy')).toBe(1);

      const appTwo = createApp(null, 2);
      expect(appTwo.get('trust proxy')).toBe(2);

      expect(() => createApp(null, '-1')).toThrow(/Invalid TRUST_PROXY configuration/);
      expect(() => createApp(null, 'abc')).toThrow(/Invalid TRUST_PROXY configuration/);
      expect(() => createApp(null, true)).toThrow(/Invalid TRUST_PROXY configuration/);
    });

    it('falls back safely to direct peer address on malformed or truncated X-Forwarded-For chain', () => {
      const handshake = {
        address: '10.0.0.1',
        headers: { 'x-forwarded-for': 'invalid-not-an-ip' }
      };
      expect(resolveClientIp(handshake, 1)).toBe('10.0.0.1');
    });

    it('strips port numbers from IPv4 and bracketed IPv6 forwarded addresses safely', () => {
      const handshakeV4 = {
        address: '10.0.0.1',
        headers: { 'x-forwarded-for': '198.51.100.5:8080' }
      };
      expect(resolveClientIp(handshakeV4, 1)).toBe('198.51.100.5');

      const handshakeV6 = {
        address: '10.0.0.1',
        headers: { 'x-forwarded-for': '[2001:db8::1]:8443' }
      };
      expect(resolveClientIp(handshakeV6, 1)).toBe('2001:db8::1');
    });

    it('prevents client IP spoofing by ignoring un-trusted leftmost forwarded values', () => {
      const handshake = {
        address: '10.0.0.1',
        headers: {
          'x-forwarded-for': 'spoofed.attacker.ip, 203.0.113.50'
        }
      };
      // With trustProxy = 1, only the rightmost entry (203.0.113.50) is trusted
      expect(resolveClientIp(handshake, 1)).toBe('203.0.113.50');
    });
  });

  // =========================================================================
  // 3. CORS & Origin Validation (4 tests)
  // =========================================================================
  describe('3. CORS & Origin Validation', () => {
    it('allows connection from configured production origin with credentials: false', async () => {
      const client = createClient({
        auth: { token: 'valid_active_token' },
        extraHeaders: {
          origin: 'https://zync-app.vercel.app'
        }
      });

      const connected = await waitForConnect(client);
      expect(connected.connected).toBe(true);
    });

    it('allows connection from configured development origins (localhost:5173)', async () => {
      const client = createClient({
        auth: { token: 'valid_active_token' },
        extraHeaders: {
          origin: 'http://localhost:5173'
        }
      });

      const connected = await waitForConnect(client);
      expect(connected.connected).toBe(true);
    });

    it('rejects handshake when Origin header is unauthorized or malformed', async () => {
      const client = createClient({
        auth: { token: 'valid_active_token' },
        extraHeaders: {
          origin: 'https://malicious-site.example.com'
        }
      });

      const err = await waitForConnectError(client);
      expect(err.message).toBe('CORS_ORIGIN_DENIED');
      expect(err.data?.code).toBe('CORS_ORIGIN_DENIED');
    });

    it('permits non-browser clients (omitted Origin header) with valid auth token', async () => {
      const client = createClient({
        auth: { token: 'valid_active_token' }
      });

      const connected = await waitForConnect(client);
      expect(connected.connected).toBe(true);
    });
  });

  // =========================================================================
  // 4. Firebase Handshake Authentication (5 tests)
  // =========================================================================
  describe('4. Firebase Handshake Authentication', () => {
    it('rejects connection when no auth token or Bearer header is provided', async () => {
      const client = createClient({});
      const err = await waitForConnectError(client);
      expect(err.message).toBe('AUTH_REQUIRED');
      expect(err.data?.code).toBe('AUTH_REQUIRED');
    });

    it('rejects connection when token is invalid, expired, or malformed', async () => {
      const client = createClient({
        auth: { token: 'invalid_malformed_token' }
      });
      const err = await waitForConnectError(client);
      expect(err.message).toBe('INVALID_TOKEN');
      expect(err.data?.code).toBe('INVALID_TOKEN');
    });

    it('rejects connection when Firebase UID does not match any MongoDB UserProfile', async () => {
      const client = createClient({
        auth: { token: 'valid_no_profile_token' }
      });
      const err = await waitForConnectError(client);
      expect(err.message).toBe('USER_NOT_FOUND');
      expect(err.data?.code).toBe('USER_NOT_FOUND');
    });

    it('successfully authenticates valid token and resolves UserProfile context', async () => {
      const client = createClient({
        auth: { token: 'valid_active_token' }
      });

      const connected = await waitForConnect(client);
      expect(connected.connected).toBe(true);

      const serverSocket = ioServer.sockets.sockets.get(connected.id);
      expect(serverSocket).toBeDefined();
      expect(serverSocket.data.user).toBeDefined();
      expect(serverSocket.data.user.profileId).toBe(activeUserProfile._id.toString());
      expect(serverSocket.data.user.role).toBe('user');
      expect(serverSocket.data.user.accountStatus).toBe('active');
    });

    it('attaches server-derived role and accountStatus to socket.data.user (never client-supplied)', async () => {
      const client = createClient({
        auth: {
          token: 'valid_active_token',
          role: 'super_admin', // Attacker trying to elevate privileges
          accountStatus: 'active'
        }
      });

      const connected = await waitForConnect(client);
      const serverSocket = ioServer.sockets.sockets.get(connected.id);
      expect(serverSocket.data.user.role).toBe('user'); // Kept server-derived
    });
  });

  // =========================================================================
  // 5. Room Policy & Authorization (4 tests)
  // =========================================================================
  describe('5. Room Policy & Authorization', () => {
    it('places active ordinary user into official:<id> and user:<id> rooms', async () => {
      const client = createClient({
        auth: { token: 'valid_active_token' }
      });

      const connected = await waitForConnect(client);
      const serverSocket = ioServer.sockets.sockets.get(connected.id);

      const profileId = activeUserProfile._id.toString();
      await waitForRoom(serverSocket, `official:${profileId}`);
      expect(serverSocket.rooms.has(`official:${profileId}`)).toBe(true);
      expect(serverSocket.rooms.has(`user:${profileId}`)).toBe(true);
      expect(serverSocket.rooms.has('admin:staff')).toBe(false);
    });

    it('places active super_admin into official:<id>, user:<id>, and admin:staff rooms', async () => {
      const client = createClient({
        auth: { token: 'valid_admin_token' }
      });

      const connected = await waitForConnect(client);
      const serverSocket = ioServer.sockets.sockets.get(connected.id);

      const profileId = adminUserProfile._id.toString();
      await waitForRoom(serverSocket, 'admin:staff');
      expect(serverSocket.rooms.has(`official:${profileId}`)).toBe(true);
      expect(serverSocket.rooms.has(`user:${profileId}`)).toBe(true);
      expect(serverSocket.rooms.has('admin:staff')).toBe(true);
    });

    it('places suspended user into official:<id> only, excluding user:<id> and admin:staff', async () => {
      const client = createClient({
        auth: { token: 'valid_suspended_token' }
      });

      const connected = await waitForConnect(client);
      const serverSocket = ioServer.sockets.sockets.get(connected.id);

      const profileId = suspendedUserProfile._id.toString();
      await waitForRoom(serverSocket, `official:${profileId}`);
      expect(serverSocket.rooms.has(`official:${profileId}`)).toBe(true);
      expect(serverSocket.rooms.has(`user:${profileId}`)).toBe(false);
      expect(serverSocket.rooms.has('admin:staff')).toBe(false);
    });

    it('prevents client from joining unauthorized privileged rooms via arbitrary socket emits', async () => {
      const client = createClient({
        auth: { token: 'valid_active_token' }
      });

      const connected = await waitForConnect(client);
      const serverSocket = ioServer.sockets.sockets.get(connected.id);

      // Attempt to join admin room via arbitrary client emit
      connected.emit('join', 'admin:staff');
      await new Promise((r) => setTimeout(r, 50));

      expect(serverSocket.rooms.has('admin:staff')).toBe(false);
    });
  });

  // =========================================================================
  // 6. Account Status Synchronization & Race Handling (4 tests)
  // =========================================================================
  describe('6. Account Status Synchronization & Race Handling', () => {
    it('syncSocketRooms evicts suspended user from user:<id> while preserving official:<id>', async () => {
      const client = createClient({
        auth: { token: 'valid_active_token' }
      });

      const connected = await waitForConnect(client);
      const serverSocket = ioServer.sockets.sockets.get(connected.id);
      const profileId = activeUserProfile._id.toString();

      await waitForRoom(serverSocket, `user:${profileId}`);
      expect(serverSocket.rooms.has(`user:${profileId}`)).toBe(true);

      // Admin suspends user
      await UserProfile.findByIdAndUpdate(profileId, { accountStatus: 'suspended' });
      await syncSocketRooms(profileId);

      await waitForRoom(serverSocket, `user:${profileId}`, false);
      expect(serverSocket.rooms.has(`official:${profileId}`)).toBe(true);
      expect(serverSocket.rooms.has(`user:${profileId}`)).toBe(false);
    });

    it('emits account:status_changed directly to affected socket instances on suspension', async () => {
      const client = createClient({
        auth: { token: 'valid_active_token' }
      });

      const connected = await waitForConnect(client);
      const profileId = activeUserProfile._id.toString();

      const statusChangedPromise = new Promise((resolve) => {
        connected.on('account:status_changed', resolve);
      });

      await UserProfile.findByIdAndUpdate(profileId, { accountStatus: 'suspended' });
      await syncSocketRooms(profileId);

      const payload = await statusChangedPromise;
      expect(payload).toEqual({ accountStatus: 'suspended' });
    });

    it('post-join status guard catches suspension occurring during handshake and strips user room', async () => {
      // Create user that starts active
      const user = await UserProfile.create({
        firebaseUid: 'socket-test-race-uid',
        displayName: 'Race Tester',
        email: 'socket-test-race@zync.test',
        role: 'user',
        accountStatus: 'active'
      });

      // Immediately suspend in DB before socket connection setup completes
      await UserProfile.findByIdAndUpdate(user._id, { accountStatus: 'suspended' });

      const client = createClient({
        auth: { token: 'socket-test-token-race-uid' }
      });

      const connected = await waitForConnect(client);
      const serverSocket = ioServer.sockets.sockets.get(connected.id);

      await waitForRoom(serverSocket, `official:${user._id}`);
      expect(serverSocket.rooms.has(`official:${user._id}`)).toBe(true);
      expect(serverSocket.rooms.has(`user:${user._id}`)).toBe(false);
    });

    it('concurrent admin status update successfully triggers async syncSocketRooms without error', async () => {
      const client = createClient({
        auth: { token: 'valid_active_token' }
      });

      const connected = await waitForConnect(client);
      const profileId = activeUserProfile._id.toString();

      const statusChangedPromise = new Promise((resolve) => {
        connected.on('account:status_changed', resolve);
      });

      // Invoke updateUserStatus controller directly
      const req = {
        params: { id: profileId },
        body: { status: 'suspended' },
        user: { uid: 'some-admin-uid' }
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      };

      await updateUserStatus(req, res);
      expect(res.status).toHaveBeenCalledWith(200);

      const payload = await statusChangedPromise;
      expect(payload).toEqual({ accountStatus: 'suspended' });
    });

    it('syncSocketRooms server-authoritatively reconciles admin:staff room membership when user role changes', async () => {
      const client = createClient({
        auth: { token: 'valid_active_token' }
      });

      const connected = await waitForConnect(client);
      const serverSocket = ioServer.sockets.sockets.get(connected.id);
      const profileId = activeUserProfile._id.toString();

      await waitForRoom(serverSocket, `user:${profileId}`, true);
      expect(serverSocket.rooms.has('admin:staff')).toBe(false);
      expect(serverSocket.data.user.role).toBe('user');

      // Promote user to super_admin in MongoDB and synchronize
      await UserProfile.findByIdAndUpdate(profileId, { role: 'super_admin' });
      await syncSocketRooms(profileId);

      await waitForRoom(serverSocket, 'admin:staff', true);
      expect(serverSocket.rooms.has('admin:staff')).toBe(true);
      expect(serverSocket.data.user.role).toBe('super_admin');

      // Demote user back to ordinary user in MongoDB and synchronize
      await UserProfile.findByIdAndUpdate(profileId, { role: 'user' });
      await syncSocketRooms(profileId);

      await waitForRoom(serverSocket, 'admin:staff', false);
      expect(serverSocket.rooms.has('admin:staff')).toBe(false);
      expect(serverSocket.data.user.role).toBe('user');
    });
  });

  // =========================================================================
  // 7. Connection Lifecycle & Clean Teardown (2 tests)
  // =========================================================================
  describe('7. Connection Lifecycle & Clean Teardown', () => {
    it('disconnects all active sockets and closes cleanly', async () => {
      const client = createClient({
        auth: { token: 'valid_active_token' }
      });

      const connected = await waitForConnect(client);
      expect(connected.connected).toBe(true);

      const disconnectPromise = new Promise((resolve) => {
        connected.on('disconnect', resolve);
      });

      connected.disconnect();
      await disconnectPromise;
      expect(connected.connected).toBe(false);
    });

    it('verifies getDesiredRooms produces accurate room sets for all user roles and statuses', () => {
      const fakeActiveUser = { _id: '123', role: 'user', accountStatus: 'active' };
      expect(getDesiredRooms(fakeActiveUser)).toEqual(['official:123', 'user:123']);

      const fakeActiveAdmin = { _id: '456', role: 'super_admin', accountStatus: 'active' };
      expect(getDesiredRooms(fakeActiveAdmin)).toEqual(['official:456', 'user:456', 'admin:staff']);

      const fakeSuspendedUser = { _id: '789', role: 'user', accountStatus: 'suspended' };
      expect(getDesiredRooms(fakeSuspendedUser)).toEqual(['official:789']);

      const fakeSuspendedAdmin = { _id: '999', role: 'super_admin', accountStatus: 'suspended' };
      expect(getDesiredRooms(fakeSuspendedAdmin)).toEqual(['official:999']);
    });
  });
});
