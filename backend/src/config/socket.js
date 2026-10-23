import { Server } from 'socket.io';
import proxyaddr from 'proxy-addr';
import net from 'net';
import admin from './firebase-admin.js';
import UserProfile from '../models/UserProfile.js';
import { getAllowedOrigins } from './cors.js';
import { validateTrustProxy } from './proxy.js';
import { setupSocketConnection } from '../services/socketService.js';
import { _resetPresenceManager } from '../services/presenceManager.js';

let ioInstance = null;

// Sliding-window rate limiter state: ip -> [timestamp, timestamp, ...]
const ipBuckets = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_ATTEMPTS_PER_WINDOW = 60;

// Periodic cleanup of stale rate limiter buckets (unreferenced timer to prevent test leaks)
let cleanupTimer = null;

function ensureCleanupTimer() {
  if (!cleanupTimer) {
    cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [ip, timestamps] of ipBuckets.entries()) {
        const valid = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
        if (valid.length === 0) {
          ipBuckets.delete(ip);
        } else {
          ipBuckets.set(ip, valid);
        }
      }
    }, RATE_LIMIT_WINDOW_MS);
    if (cleanupTimer.unref) {
      cleanupTimer.unref();
    }
  }
}

/**
 * Resets the in-memory rate limiter buckets (used for test isolation).
 */
export function _resetRateLimiter() {
  ipBuckets.clear();
}

/**
 * Checks in-memory sliding-window rate limit for a client IP.
 */
export function checkRateLimit(ip) {
  ensureCleanupTimer();
  const now = Date.now();
  const timestamps = (ipBuckets.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);

  if (timestamps.length >= MAX_ATTEMPTS_PER_WINDOW) {
    return false;
  }

  timestamps.push(now);
  ipBuckets.set(ip, timestamps);
  return true;
}

/**
 * Resolves the client IP address from a socket handshake using proxy-addr.
 * Safely defaults to the direct TCP peer address whenever proxy trust is 0 or unconfigured.
 * Never uses X-Real-IP as a fallback.
 */
export function resolveClientIp(handshake, trustProxyConfig) {
  const req = handshake?.request || handshake;
  const directPeer =
    handshake?.address ||
    req?.connection?.remoteAddress ||
    req?.socket?.remoteAddress ||
    '127.0.0.1';

  const parsedHops = validateTrustProxy(trustProxyConfig);

  // If trustProxy is 0 (direct TCP peer, no proxy hops), return direct peer immediately
  if (parsedHops === 0) {
    return directPeer;
  }

  const headers = handshake?.headers || req?.headers || {};
  const trustFn = (addr, i) => i < parsedHops;

  const mockReq = {
    headers,
    connection: { remoteAddress: directPeer }
  };

  try {
    const resolved = proxyaddr(mockReq, trustFn);
    if (typeof resolved === 'string') {
      // Strip bracketed IPv6 ports [2001:db8::1]:8080 or IPv4 ports 1.2.3.4:8080
      const cleanIp = resolved
        .replace(/^\[([a-fA-F0-9:]+)\](?::\d+)?$/, '$1')
        .replace(/^(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/, '$1');

      if (net.isIP(cleanIp) !== 0) {
        return cleanIp;
      }
    }
  } catch (err) {
    // Malformed headers fail safe to direct TCP peer
  }

  return directPeer;
}

/**
 * Initializes Socket.IO on the provided HTTP server.
 */
export function initSocket(httpServer, config = {}) {
  const allowedOrigins = config.allowedOrigins || getAllowedOrigins();
  const trustProxy = validateTrustProxy(config.trustProxy);

  const io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      credentials: false
    },
    ...config.serverOptions
  });

  // 1. Rate Limiting Middleware (executed before expensive crypto/Firebase calls)
  io.use((socket, next) => {
    const clientIp = resolveClientIp(socket.handshake, trustProxy);
    socket.data = socket.data || {};
    socket.data.clientIp = clientIp;

    if (!checkRateLimit(clientIp)) {
      const err = new Error('RATE_LIMIT_EXCEEDED');
      err.data = { code: 'RATE_LIMIT_EXCEEDED' };
      return next(err);
    }
    next();
  });

  // 2. Origin Verification Middleware
  io.use((socket, next) => {
    const origin = socket.handshake.headers?.origin;

    // Missing origin: allow past origin gate (supports non-browser clients and tests)
    // Does not grant trust or bypass Firebase auth
    if (!origin) {
      return next();
    }

    // Origin is present: must match allowed origins list exactly
    if (!allowedOrigins.includes(origin)) {
      const err = new Error('CORS_ORIGIN_DENIED');
      err.data = { code: 'CORS_ORIGIN_DENIED' };
      return next(err);
    }

    next();
  });

  // 3. Firebase Authentication & User Context Middleware
  io.use(async (socket, next) => {
    try {
      let token = socket.handshake.auth?.token;

      if (!token && socket.handshake.headers?.authorization) {
        const authHeader = socket.handshake.headers.authorization;
        if (authHeader.startsWith('Bearer ')) {
          token = authHeader.split(' ')[1];
        }
      }

      if (!token || typeof token !== 'string') {
        const err = new Error('AUTH_REQUIRED');
        err.data = { code: 'AUTH_REQUIRED' };
        return next(err);
      }

      let decoded;
      try {
        decoded = await admin.auth().verifyIdToken(token);
      } catch (authErr) {
        const err = new Error('INVALID_TOKEN');
        err.data = { code: 'INVALID_TOKEN' };
        return next(err);
      }

      const profile = await UserProfile.findOne({ firebaseUid: decoded.uid })
        .select('_id firebaseUid role accountStatus')
        .lean();

      if (!profile) {
        const err = new Error('USER_NOT_FOUND');
        err.data = { code: 'USER_NOT_FOUND' };
        return next(err);
      }

      // Attach only server-derived context
      socket.data.user = {
        profileId: profile._id.toString(),
        firebaseUid: profile.firebaseUid,
        role: profile.role,
        accountStatus: profile.accountStatus
      };

      next();
    } catch (err) {
      const internalErr = new Error('AUTHENTICATION_FAILED');
      internalErr.data = { code: 'AUTHENTICATION_FAILED' };
      next(internalErr);
    }
  });

  // Connection Handler: Set up rooms and status guards
  io.on('connection', async (socket) => {
    try {
      await setupSocketConnection(socket);
    } catch (err) {
      console.error('[Socket] Connection setup failed:', err);
    }
  });

  ioInstance = io;
  return io;
}

/**
 * Returns the current Socket.IO server singleton instance.
 */
export function getIO() {
  return ioInstance;
}

/**
 * Clears the active Socket.IO server singleton (used during test teardown).
 */
export function _resetIO() {
  ioInstance = null;
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  _resetPresenceManager();
}
