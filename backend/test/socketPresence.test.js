import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import { io as ioClient } from 'socket.io-client';
import express from 'express';
import request from 'supertest';

import { connectTestDB, closeTestDB } from './setup.js';
import UserProfile from '../src/models/UserProfile.js';
import Connection from '../src/models/Connection.js';
import Conversation from '../src/models/Conversation.js';
import {
  initSocket,
  getIO,
  _resetIO,
  _resetRateLimiter
} from '../src/config/socket.js';
import {
  setGracePeriodMs,
  getGracePeriodMs,
  getActiveSocketCount,
  hasActiveConnections,
  hasPendingGraceTimer,
  broadcastPresenceUpdate,
  _resetPresenceManager
} from '../src/services/presenceManager.js';

import presenceRoutes from '../src/routes/presenceRoutes.js';
import connectionRoutes from '../src/routes/connectionRoutes.js';
import chatRoutes from '../src/routes/chatRoutes.js';
import matchRoutes from '../src/routes/matchRoutes.js';

// Mock Firebase Admin token verification for Socket.IO
vi.mock('../src/config/firebase-admin.js', () => ({
  default: {
    auth: () => ({
      verifyIdToken: async (token) => {
        if (token === 'token-alice') {
          return { uid: 'socket-presence-alice', email: 'alice@zync.test' };
        }
        if (token === 'token-bob') {
          return { uid: 'socket-presence-bob', email: 'bob@zync.test' };
        }
        if (token === 'token-suspended') {
          return { uid: 'socket-presence-suspended', email: 'suspended@zync.test' };
        }
        if (token === 'token-charlie') {
          return { uid: 'socket-presence-charlie', email: 'charlie@zync.test' };
        }
        if (token === 'token-david') {
          return { uid: 'socket-presence-david', email: 'david@zync.test' };
        }
        if (typeof token === 'string' && token.startsWith('socket-presence-')) {
          return { uid: token, email: `${token}@zync.test` };
        }
        throw new Error('Firebase ID token is invalid or expired');
      }
    })
  }
}));

// Mock auth middleware for REST requests
vi.mock('../src/middleware/authMiddleware.js', () => ({
  verifyToken: (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: 'Unauthorized' });
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    const token = parts[1];
    if (token === 'invalid') return res.status(401).json({ message: 'Unauthorized' });
    req.user = { uid: token, email: `${token}@zync.test` };
    next();
  }
}));

// Mock rate limiters so they don't block tests
vi.mock('../src/middleware/rateLimitMiddleware.js', () => ({
  matchDiscoveryRateLimiter: (req, res, next) => next(),
  matchExplanationRateLimiter: (req, res, next) => next(),
  messageSendRateLimiter: (req, res, next) => next(),
  connectionRequestRateLimiter: (req, res, next) => next()
}));

// Mock socketService internal broadcasts if any
vi.mock('../src/services/socketService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    emitToUser: vi.fn(),
    emitToOfficialConversation: vi.fn()
  };
});

describe('Checkpoint P3: Socket.IO Presence Tracking & Grace Period', () => {
  let app;
  let server;
  let port;
  let ioServer;
  const activeClients = new Set();

  let aliceProfile;
  let bobProfile;
  let suspendedProfile;

  const allowedOrigins = ['http://localhost:5173'];

  function createClient(token, options = {}) {
    const client = ioClient(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      autoConnect: false,
      timeout: 3000,
      auth: { token },
      extraHeaders: { origin: 'http://localhost:5173' },
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

  function waitForDisconnect(client) {
    return new Promise((resolve) => {
      if (!client.connected) return resolve();
      client.once('disconnect', () => resolve());
      client.disconnect();
    });
  }

  async function waitForActiveSocketCount(userId, targetCount, maxWaitMs = 1500) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      if (getActiveSocketCount(userId) === targetCount) {
        return true;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    return getActiveSocketCount(userId) === targetCount;
  }

  async function waitForServerGraceTimer(userId, shouldHave = true, maxWaitMs = 1500) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      if (hasPendingGraceTimer(userId) === shouldHave) {
        return true;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    return hasPendingGraceTimer(userId) === shouldHave;
  }

  async function waitForDbOnline(userId, isOnline, maxWaitMs = 2000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const doc = await UserProfile.findById(userId);
      if (doc && doc.isOnline === isOnline) {
        return doc;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    return await UserProfile.findById(userId);
  }

  beforeAll(async () => {
    await connectTestDB();

    app = express();
    app.use(express.json());
    app.use('/api/presence', presenceRoutes);
    app.use('/api/connections', connectionRoutes);
    app.use('/api/chat', chatRoutes);
    app.use('/api/matches', matchRoutes);

    server = http.createServer(app);
    ioServer = initSocket(server, {
      trustProxy: 0,
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

    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }

    await closeTestDB();
  });

  beforeEach(async () => {
    _resetRateLimiter();
    _resetPresenceManager();
    setGracePeriodMs(150); // 150ms test grace period for fast, deterministic tests

    // Clean up only socket-presence scoped test data to avoid parallel race conditions with other suites
    await UserProfile.deleteMany({ firebaseUid: /^socket-presence-/ });

    aliceProfile = await UserProfile.create({
      firebaseUid: 'socket-presence-alice',
      displayName: 'Alice',
      email: 'alice@zync.test',
      role: 'user',
      accountStatus: 'active',
      visibilityPreference: 'online',
      isOnline: false,
      onlineUntil: null,
      games: [{
        gameName: 'Valorant',
        inGameName: 'Alice#1234',
        skillLevel: 50,
        availability: ['evening'],
        roles: ['duelist'],
        playstyle: 'Aggressive',
        communication: 'Voice',
        competitiveGoals: 'Ranked'
      }]
    });

    bobProfile = await UserProfile.create({
      firebaseUid: 'socket-presence-bob',
      displayName: 'Bob',
      email: 'bob@zync.test',
      role: 'user',
      accountStatus: 'active',
      visibilityPreference: 'online',
      isOnline: false,
      onlineUntil: null,
      games: [{
        gameName: 'Valorant',
        inGameName: 'Bob#5678',
        skillLevel: 50,
        availability: ['evening'],
        roles: ['initiator'],
        playstyle: 'Tactical',
        communication: 'Voice',
        competitiveGoals: 'Ranked'
      }]
    });

    suspendedProfile = await UserProfile.create({
      firebaseUid: 'socket-presence-suspended',
      displayName: 'Suspended Sam',
      email: 'sam@zync.test',
      role: 'user',
      accountStatus: 'suspended',
      visibilityPreference: 'online',
      isOnline: false,
      onlineUntil: null
    });

    await Connection.deleteMany({
      $or: [
        { requester: { $in: [aliceProfile._id, bobProfile._id] } },
        { recipient: { $in: [aliceProfile._id, bobProfile._id] } }
      ]
    });
    await Conversation.deleteMany({
      participants: { $in: [aliceProfile._id, bobProfile._id] }
    });
  });

  afterEach(async () => {
    for (const client of activeClients) {
      if (client.connected || client.connecting) {
        client.disconnect();
      }
    }
    activeClients.clear();
    _resetPresenceManager();
  });

  it('1. Authenticated connection transitions an eligible Online-preference user to Online', async () => {
    const client = createClient('token-alice');
    await waitForConnect(client);

    const freshAlice = await waitForDbOnline(aliceProfile._id, true);
    expect(freshAlice.isOnline).toBe(true);
    expect(freshAlice.onlineUntil).toBeDefined();
    expect(new Date(freshAlice.onlineUntil).getTime()).toBeGreaterThan(Date.now());
    expect(getActiveSocketCount(aliceProfile._id)).toBe(1);
    expect(hasActiveConnections(aliceProfile._id)).toBe(true);
  });

  it('2. Invisible users remain Offline after socket connection', async () => {
    await UserProfile.findByIdAndUpdate(bobProfile._id, {
      $set: { visibilityPreference: 'invisible' }
    });

    const client = createClient('token-bob');
    await waitForConnect(client);

    await new Promise((r) => setTimeout(r, 60));

    expect(getActiveSocketCount(bobProfile._id)).toBe(1);

    const freshBob = await UserProfile.findById(bobProfile._id);
    expect(freshBob.isOnline).toBe(false);
    expect(freshBob.onlineUntil).toBeNull();
  });

  it('3. Multiple sockets: disconnecting one of two sockets does not mark the user Offline', async () => {
    const clientTab1 = createClient('token-alice');
    const clientTab2 = createClient('token-alice');

    await waitForConnect(clientTab1);
    await waitForConnect(clientTab2);

    await waitForDbOnline(aliceProfile._id, true);
    await waitForActiveSocketCount(aliceProfile._id, 2);
    expect(getActiveSocketCount(aliceProfile._id)).toBe(2);

    // Disconnect Tab 1
    await waitForDisconnect(clientTab1);
    await new Promise((r) => setTimeout(r, 60));

    expect(getActiveSocketCount(aliceProfile._id)).toBe(1);
    expect(hasPendingGraceTimer(aliceProfile._id)).toBe(false); // No grace timer while Tab 2 is active

    const freshAlice = await UserProfile.findById(aliceProfile._id);
    expect(freshAlice.isOnline).toBe(true);
    expect(freshAlice.onlineUntil).toBeDefined();
  });

  it('4. Last-socket disconnect schedules the grace period', async () => {
    const client = createClient('token-alice');
    await waitForConnect(client);
    await waitForDbOnline(aliceProfile._id, true);

    await waitForDisconnect(client);
    const hasTimer = await waitForServerGraceTimer(aliceProfile._id, true);
    expect(hasTimer).toBe(true);
    expect(getActiveSocketCount(aliceProfile._id)).toBe(0);

    // User is still online while grace timer is running
    const freshAlice = await UserProfile.findById(aliceProfile._id);
    expect(freshAlice.isOnline).toBe(true);
  });

  it('5. Reconnection cancels the pending grace timer', async () => {
    const client1 = createClient('token-alice');
    await waitForConnect(client1);
    await waitForDbOnline(aliceProfile._id, true);

    // Disconnect
    await waitForDisconnect(client1);
    const hasTimer = await waitForServerGraceTimer(aliceProfile._id, true);
    expect(hasTimer).toBe(true);

    // Reconnect client within grace window (150ms)
    const client2 = createClient('token-alice');
    await waitForConnect(client2);
    const timerCancelled = await waitForServerGraceTimer(aliceProfile._id, false);
    expect(timerCancelled).toBe(true);

    // Wait past the original grace window duration
    await new Promise((r) => setTimeout(r, 180));

    const freshAlice = await UserProfile.findById(aliceProfile._id);
    expect(freshAlice.isOnline).toBe(true);
    expect(freshAlice.onlineUntil).toBeDefined();
  });

  it('6. Grace-period expiry marks the user Offline and updates lastSeen', async () => {
    const client = createClient('token-alice');
    await waitForConnect(client);
    await waitForDbOnline(aliceProfile._id, true);

    const beforeDisconnect = new Date();
    await waitForDisconnect(client);

    // Wait for DB transition to offline after grace period expires
    const freshAlice = await waitForDbOnline(aliceProfile._id, false, 2500);

    expect(freshAlice.isOnline).toBe(false);
    expect(freshAlice.onlineUntil).toBeNull();
    expect(freshAlice.lastSeen).toBeDefined();
    expect(new Date(freshAlice.lastSeen).getTime()).toBeGreaterThanOrEqual(beforeDisconnect.getTime() - 1000);
    expect(hasPendingGraceTimer(aliceProfile._id)).toBe(false);
  });

  it('7. Stale timers or delayed database writes cannot overwrite a newer Online state', async () => {
    const client1 = createClient('token-alice');
    await waitForConnect(client1);
    await waitForDbOnline(aliceProfile._id, true);

    // Disconnect client1 to start grace timer
    await waitForDisconnect(client1);
    const hasTimer = await waitForServerGraceTimer(aliceProfile._id, true);
    expect(hasTimer).toBe(true);

    // Reconnect client2
    const client2 = createClient('token-alice');
    await waitForConnect(client2);
    await waitForServerGraceTimer(aliceProfile._id, false);

    // Wait past whatever time the original timer would have fired
    await new Promise((r) => setTimeout(r, 200));

    // User must remain Online
    const freshAlice = await UserProfile.findById(aliceProfile._id);
    expect(freshAlice.isOnline).toBe(true);
    expect(freshAlice.onlineUntil).toBeDefined();
  });

  it('8. Explicit logout: multi-tab logout of one tab preserves online; final tab logout marks offline immediately', async () => {
    const clientTab1 = createClient('token-alice');
    const clientTab2 = createClient('token-alice');

    await waitForConnect(clientTab1);
    await waitForConnect(clientTab2);
    await waitForActiveSocketCount(aliceProfile._id, 2);
    await waitForDbOnline(aliceProfile._id, true);

    // Tab 1 emits auth:logout
    clientTab1.emit('auth:logout');
    const countReached = await waitForActiveSocketCount(aliceProfile._id, 1);
    expect(countReached).toBe(true);

    // Alice still has Tab 2 connected -> remains Online
    expect(getActiveSocketCount(aliceProfile._id)).toBe(1);
    let freshAlice = await UserProfile.findById(aliceProfile._id);
    expect(freshAlice.isOnline).toBe(true);

    // Tab 2 emits auth:logout -> final socket -> marks offline immediately without grace wait
    clientTab2.emit('auth:logout');
    const countZeroReached = await waitForActiveSocketCount(aliceProfile._id, 0);
    expect(countZeroReached).toBe(true);
    freshAlice = await waitForDbOnline(aliceProfile._id, false, 2000);

    expect(getActiveSocketCount(aliceProfile._id)).toBe(0);
    expect(hasPendingGraceTimer(aliceProfile._id)).toBe(false);
    expect(freshAlice.isOnline).toBe(false);
    expect(freshAlice.onlineUntil).toBeNull();
  });

  it('9. Suspended-user socket and presence behavior', async () => {
    const suspendedClient = createClient('token-suspended');
    await waitForConnect(suspendedClient);
    await new Promise((r) => setTimeout(r, 60));

    // Suspended user should not be tracked as active presence
    expect(getActiveSocketCount(suspendedProfile._id)).toBe(0);

    const freshSuspended = await UserProfile.findById(suspendedProfile._id);
    expect(freshSuspended.isOnline).toBe(false);
    expect(freshSuspended.onlineUntil).toBeNull();
  });

  it('10. Existing REST presence, matching, and connection consumers remain consistent with socket presence', async () => {
    // Connect Bob via socket
    const bobClient = createClient('token-bob');
    await waitForConnect(bobClient);
    await waitForDbOnline(bobProfile._id, true);

    // Setup accepted connection between Alice and Bob
    await Connection.create({
      requester: aliceProfile._id,
      recipient: bobProfile._id,
      status: 'accepted'
    });

    // 1. GET /api/presence/me for Bob reports isOnline: true
    const presenceRes = await request(app)
      .get('/api/presence/me')
      .set('Authorization', 'Bearer socket-presence-bob');
    expect(presenceRes.status).toBe(200);
    expect(presenceRes.body.isOnline).toBe(true);

    // 2. GET /api/connections for Alice reports Bob as isOnline: true with valid onlineUntil
    const connRes = await request(app)
      .get('/api/connections')
      .set('Authorization', 'Bearer socket-presence-alice');
    expect(connRes.status).toBe(200);
    expect(connRes.body.length).toBe(1);
    expect(connRes.body[0].user.isOnline).toBe(true);
    expect(new Date(connRes.body[0].user.onlineUntil).getTime()).toBeGreaterThan(Date.now());

    // 3. GET /api/matches for Alice reports Bob as online candidate
    await Connection.deleteMany({
      $or: [
        { requester: { $in: [aliceProfile._id, bobProfile._id] } },
        { recipient: { $in: [aliceProfile._id, bobProfile._id] } }
      ]
    });
    const matchRes = await request(app)
      .get('/api/matches')
      .set('Authorization', 'Bearer socket-presence-alice');
    expect(matchRes.status).toBe(200);
    const candidateBob = matchRes.body.matches.find(m => m.userId === bobProfile._id.toString());
    expect(candidateBob).toBeDefined();
    expect(candidateBob.isOnline).toBe(true);
  });

  it('11. Cleanup and shutdown do not leak timers or leave unsafe state', () => {
    _resetPresenceManager();
    expect(hasPendingGraceTimer(aliceProfile._id)).toBe(false);
    expect(getActiveSocketCount(aliceProfile._id)).toBe(0);
  });

  describe('Checkpoint P4: Real-Time Presence Broadcasts', () => {
    let charlieProfile;
    let davidProfile;

    beforeEach(async () => {
      // Ensure Alice and Bob are accepted friends
      await UserProfile.findByIdAndUpdate(aliceProfile._id, {
        $set: { connections: [bobProfile._id], isOnline: false, onlineUntil: null, visibilityPreference: 'online' }
      });
      await UserProfile.findByIdAndUpdate(bobProfile._id, {
        $set: { connections: [aliceProfile._id], isOnline: false, onlineUntil: null, visibilityPreference: 'online' }
      });

      // Charlie: conversation participant with Alice, but not friend in connections
      await UserProfile.deleteMany({ firebaseUid: { $in: ['socket-presence-charlie', 'socket-presence-david'] } });
      charlieProfile = await UserProfile.create({
        firebaseUid: 'socket-presence-charlie',
        email: 'charlie@zync.test',
        displayName: 'Charlie',
        role: 'user',
        accountStatus: 'active',
        isOnline: false,
        onlineUntil: null,
        visibilityPreference: 'online',
        connections: []
      });

      // David: unrelated stranger
      davidProfile = await UserProfile.create({
        firebaseUid: 'socket-presence-david',
        email: 'david@zync.test',
        displayName: 'David',
        role: 'user',
        accountStatus: 'active',
        isOnline: false,
        onlineUntil: null,
        visibilityPreference: 'online',
        connections: []
      });
    });

    it('12. Genuine Online transition reaches authorized friend and does not leak private fields', async () => {
      const bobClient = createClient('token-bob');
      await waitForConnect(bobClient);

      const aliceEvents = [];
      bobClient.on('presence:update', (data) => {
        if (data.userId === aliceProfile._id.toString()) {
          aliceEvents.push(data);
        }
      });

      const aliceClient = createClient('token-alice');
      await waitForConnect(aliceClient);
      await waitForDbOnline(aliceProfile._id, true);

      await new Promise((r) => setTimeout(r, 100));

      expect(aliceEvents.length).toBe(1);
      const event = aliceEvents[0];
      expect(event.userId).toBe(aliceProfile._id.toString());
      expect(event.isOnline).toBe(true);
      expect(event.lastSeen).toBeDefined();

      // Privacy verification: no leaked private fields
      expect(event.visibilityPreference).toBeUndefined();
      expect(event.firebaseUid).toBeUndefined();
      expect(event.email).toBeUndefined();
      expect(event.tokens).toBeUndefined();
      expect(event.activeSockets).toBeUndefined();
    });

    it('13. Offline transition after grace-period expiry reaches authorized recipient', async () => {
      const aliceClient = createClient('token-alice');
      await waitForConnect(aliceClient);
      await waitForDbOnline(aliceProfile._id, true);

      const bobClient = createClient('token-bob');
      await waitForConnect(bobClient);

      const aliceEvents = [];
      bobClient.on('presence:update', (data) => {
        if (data.userId === aliceProfile._id.toString()) {
          aliceEvents.push(data);
        }
      });

      // Alice disconnects
      await waitForDisconnect(aliceClient);
      expect(aliceEvents.length).toBe(0);

      // Wait for grace period expiry (defaultGracePeriodMs was set to 120ms in beforeEach)
      await new Promise((r) => setTimeout(r, 200));

      expect(aliceEvents.length).toBe(1);
      expect(aliceEvents[0].userId).toBe(aliceProfile._id.toString());
      expect(aliceEvents[0].isOnline).toBe(false);
    });

    it('14. Switching to Invisible emits only an ordinary Offline state, not an Invisible event', async () => {
      const aliceClient = createClient('token-alice');
      await waitForConnect(aliceClient);
      await waitForDbOnline(aliceProfile._id, true);

      const bobClient = createClient('token-bob');
      await waitForConnect(bobClient);

      const aliceEvents = [];
      bobClient.on('presence:update', (data) => {
        if (data.userId === aliceProfile._id.toString()) {
          aliceEvents.push(data);
        }
      });

      // Alice sets visibility to invisible via REST
      const res = await request(app)
        .put('/api/presence/visibility')
        .set('Authorization', 'Bearer socket-presence-alice')
        .send({ visibilityPreference: 'invisible' });
      expect(res.status).toBe(200);

      await new Promise((r) => setTimeout(r, 100));

      expect(aliceEvents.length).toBe(1);
      expect(aliceEvents[0].userId).toBe(aliceProfile._id.toString());
      expect(aliceEvents[0].isOnline).toBe(false);

      // Must NOT leak invisible
      expect(aliceEvents[0].visibilityPreference).toBeUndefined();
      expect(aliceEvents[0].invisible).toBeUndefined();
    });

    it('15. Invisible users never appear Online through socket events', async () => {
      await UserProfile.findByIdAndUpdate(aliceProfile._id, {
        $set: { visibilityPreference: 'invisible', isOnline: false, onlineUntil: null }
      });

      const bobClient = createClient('token-bob');
      await waitForConnect(bobClient);

      const aliceEvents = [];
      bobClient.on('presence:update', (data) => {
        if (data.userId === aliceProfile._id.toString()) {
          aliceEvents.push(data);
        }
      });

      const aliceClient = createClient('token-alice');
      await waitForConnect(aliceClient);
      await new Promise((r) => setTimeout(r, 100));

      expect(aliceEvents.length).toBe(0);

      const freshAlice = await UserProfile.findById(aliceProfile._id);
      expect(freshAlice.isOnline).toBe(false);
    });

    it('16. Unrelated users (strangers) do not receive private presence events', async () => {
      const davidClient = createClient('token-david');
      await waitForConnect(davidClient);

      const davidAliceEvents = [];
      davidClient.on('presence:update', (data) => {
        if (data.userId === aliceProfile._id.toString()) {
          davidAliceEvents.push(data);
        }
      });

      const bobClient = createClient('token-bob');
      await waitForConnect(bobClient);

      const bobAliceEvents = [];
      bobClient.on('presence:update', (data) => {
        if (data.userId === aliceProfile._id.toString()) {
          bobAliceEvents.push(data);
        }
      });

      const aliceClient = createClient('token-alice');
      await waitForConnect(aliceClient);
      await waitForDbOnline(aliceProfile._id, true);

      await new Promise((r) => setTimeout(r, 100));

      expect(bobAliceEvents.length).toBe(1);
      expect(bobAliceEvents[0].userId).toBe(aliceProfile._id.toString());
      expect(davidAliceEvents.length).toBe(0);
    });

    it('17. Conversation participants receive presence updates for other participants', async () => {
      await Conversation.create({
        participants: [aliceProfile._id, charlieProfile._id],
        lastSeq: 1
      });

      const charlieClient = createClient('token-charlie');
      await waitForConnect(charlieClient);

      const charlieAliceEvents = [];
      charlieClient.on('presence:update', (data) => {
        if (data.userId === aliceProfile._id.toString()) {
          charlieAliceEvents.push(data);
        }
      });

      const aliceClient = createClient('token-alice');
      await waitForConnect(aliceClient);
      await waitForDbOnline(aliceProfile._id, true);

      await new Promise((r) => setTimeout(r, 100));

      expect(charlieAliceEvents.length).toBe(1);
      expect(charlieAliceEvents[0].userId).toBe(aliceProfile._id.toString());
      expect(charlieAliceEvents[0].isOnline).toBe(true);
    });

    it('18. Unchanged presence (duplicate socket connect) does not generate duplicate transition events', async () => {
      const bobClient = createClient('token-bob');
      await waitForConnect(bobClient);

      const aliceEvents = [];
      bobClient.on('presence:update', (data) => {
        if (data.userId === aliceProfile._id.toString()) {
          aliceEvents.push(data);
        }
      });

      const aliceClient1 = createClient('token-alice');
      await waitForConnect(aliceClient1);
      await waitForDbOnline(aliceProfile._id, true);

      await new Promise((r) => setTimeout(r, 80));
      expect(aliceEvents.length).toBe(1);

      // Second tab opens -> unchanged online status
      const aliceClient2 = createClient('token-alice');
      await waitForConnect(aliceClient2);

      await new Promise((r) => setTimeout(r, 80));
      expect(aliceEvents.length).toBe(1);
    });

    it('19. Stale asynchronous operations cannot broadcast outdated state', async () => {
      const bobClient = createClient('token-bob');
      await waitForConnect(bobClient);

      const aliceEvents = [];
      bobClient.on('presence:update', (data) => {
        if (data.userId === aliceProfile._id.toString()) {
          aliceEvents.push(data);
        }
      });

      const aliceClient = createClient('token-alice');
      await waitForConnect(aliceClient);
      await waitForDbOnline(aliceProfile._id, true);

      await new Promise((r) => setTimeout(r, 80));
      expect(aliceEvents.length).toBe(1);

      // Attempt broadcast with obsolete sequence 0
      await broadcastPresenceUpdate(aliceProfile._id, false, new Date(), 0);

      await new Promise((r) => setTimeout(r, 50));
      expect(aliceEvents.length).toBe(1);
    });

    it('20. Client cannot forge another user presence by emitting presence events', async () => {
      const bobClient = createClient('token-bob');
      await waitForConnect(bobClient);

      const aliceEvents = [];
      bobClient.on('presence:update', (data) => {
        if (data.userId === aliceProfile._id.toString()) {
          aliceEvents.push(data);
        }
      });

      const davidClient = createClient('token-david');
      await waitForConnect(davidClient);

      davidClient.emit('presence:update', {
        userId: aliceProfile._id.toString(),
        isOnline: true
      });

      await new Promise((r) => setTimeout(r, 100));

      expect(aliceEvents.length).toBe(0);
      const aliceDoc = await UserProfile.findById(aliceProfile._id);
      expect(aliceDoc.isOnline).toBe(false);
    });

    it('21. Multi-tab self-synchronization: User receives their own presence updates', async () => {
      const aliceTab1 = createClient('token-alice');
      await waitForConnect(aliceTab1);
      await waitForDbOnline(aliceProfile._id, true);

      const selfEvents = [];
      aliceTab1.on('presence:update', (data) => {
        if (data.userId === aliceProfile._id.toString()) {
          selfEvents.push(data);
        }
      });

      await request(app)
        .put('/api/presence/visibility')
        .set('Authorization', 'Bearer socket-presence-alice')
        .send({ visibilityPreference: 'invisible' });

      await new Promise((r) => setTimeout(r, 100));

      expect(selfEvents.length).toBe(1);
      expect(selfEvents[0].userId).toBe(aliceProfile._id.toString());
      expect(selfEvents[0].isOnline).toBe(false);
    });
  });
});
