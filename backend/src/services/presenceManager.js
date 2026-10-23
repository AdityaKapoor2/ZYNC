import UserProfile from '../models/UserProfile.js';
import Conversation from '../models/Conversation.js';
import { getIO } from '../config/socket.js';

let defaultGracePeriodMs = 30 * 1000; // 30 seconds

// In-memory tracking state:
// userId (string) -> Set<socketId (string)>
const userSockets = new Map();

// socketId (string) -> userId (string)
const socketToUser = new Map();

// userId (string) -> { timer: NodeJS.Timeout, seq: number }
const graceTimers = new Map();

// userId (string) -> monotonic integer sequence to prevent stale async DB writes from overwriting newer state
const userOperationSeq = new Map();

/**
 * Configure grace period duration in ms (allows tests to use shorter duration or fake timers).
 */
export function setGracePeriodMs(ms) {
  defaultGracePeriodMs = ms;
}

export function getGracePeriodMs() {
  return defaultGracePeriodMs;
}

/**
 * Returns the count of active authenticated socket connections for a user.
 */
export function getActiveSocketCount(userId) {
  if (!userId) return 0;
  return userSockets.get(userId.toString())?.size || 0;
}

/**
 * Checks if a user currently has any active socket connection.
 */
export function hasActiveConnections(userId) {
  return getActiveSocketCount(userId) > 0;
}

/**
 * Checks if a user has a pending disconnect grace timer.
 */
export function hasPendingGraceTimer(userId) {
  if (!userId) return false;
  return graceTimers.has(userId.toString());
}

/**
 * Resets the in-memory presence manager state and cancels all pending timers (used for test isolation / shutdown).
 */
export function _resetPresenceManager() {
  for (const { timer } of graceTimers.values()) {
    clearTimeout(timer);
  }
  graceTimers.clear();
  userSockets.clear();
  socketToUser.clear();
  userOperationSeq.clear();
  defaultGracePeriodMs = 30 * 1000;
}

/**
 * Broadcasts a presence:update event strictly to authorized recipients:
 * 1. The user themselves in room `user:${userId}` (for multi-device / multi-tab synchronization).
 * 2. Accepted friends in room `user:${friendId}` (from UserProfile.connections).
 * 3. Conversation participants in room `user:${participantId}` (from active Conversations).
 *
 * Requirements strictly enforced:
 * - Emitted only after DB state has been saved.
 * - Minimum required public data: { userId, isOnline, lastSeen }.
 * - Invisible users are ALWAYS forced to isOnline: false.
 * - Never includes visibilityPreference, private fields, tokens, or socket counts.
 * - Unrelated users NEVER receive the event.
 * - Stale sequence operations are aborted.
 */
export async function broadcastPresenceUpdate(userId, isOnline, lastSeen = new Date(), seq) {
  if (!userId) return;
  const userIdStr = userId.toString();

  // If a sequence number was passed, verify that no newer operation superseded it
  if (seq !== undefined && userOperationSeq.get(userIdStr) !== seq) {
    return;
  }

  const io = getIO();
  if (!io) return;

  try {
    const profile = await UserProfile.findById(userIdStr).select('connections visibilityPreference');
    if (!profile) return;

    if (seq !== undefined && userOperationSeq.get(userIdStr) !== seq) {
      return;
    }

    // Safety guard: if user is invisible, isOnline must ALWAYS be false
    const safeIsOnline = profile.visibilityPreference === 'invisible' ? false : Boolean(isOnline);

    const payload = {
      userId: userIdStr,
      isOnline: safeIsOnline,
      lastSeen: lastSeen ? new Date(lastSeen).toISOString() : null
    };

    // Gather authorized recipient IDs: self + accepted connections + conversation participants
    const recipientSet = new Set();
    recipientSet.add(userIdStr);

    if (Array.isArray(profile.connections)) {
      for (const connId of profile.connections) {
        if (connId) recipientSet.add(connId.toString());
      }
    }

    try {
      const conversations = await Conversation.find({
        participants: userIdStr
      }).select('participants').lean();

      if (Array.isArray(conversations)) {
        for (const conv of conversations) {
          if (Array.isArray(conv.participants)) {
            for (const p of conv.participants) {
              if (p) recipientSet.add(p.toString());
            }
          }
        }
      }
    } catch (convErr) {
      // Fallback gracefully to connections if conversation lookup encounters an error
    }

    // Final sequence check before emitting
    if (seq !== undefined && userOperationSeq.get(userIdStr) !== seq) {
      return;
    }

    // Deliver strictly to authorized recipient rooms
    for (const recipientId of recipientSet) {
      io.to(`user:${recipientId}`).emit('presence:update', payload);
    }
  } catch (err) {
    console.error(`[Presence] Error broadcasting presence update for user ${userIdStr}:`, err);
  }
}

/**
 * Handles a newly authenticated socket connection.
 */
export async function handleSocketConnect(socket) {
  const profileId = socket.data?.user?.profileId;
  if (!profileId) return;

  const profileIdStr = profileId.toString();

  // Guard: Suspended users must not be registered for online presence
  if (socket.data?.user?.accountStatus === 'suspended') {
    return;
  }

  // 1. Register socket in tracking sets
  let sockets = userSockets.get(profileIdStr);
  if (!sockets) {
    sockets = new Set();
    userSockets.set(profileIdStr, sockets);
  }
  sockets.add(socket.id);
  socketToUser.set(socket.id, profileIdStr);

  // 2. Cancel any pending disconnect grace timer for this user
  if (graceTimers.has(profileIdStr)) {
    const { timer } = graceTimers.get(profileIdStr);
    clearTimeout(timer);
    graceTimers.delete(profileIdStr);
  }

  // 3. Increment operation sequence for race protection
  const currentSeq = (userOperationSeq.get(profileIdStr) || 0) + 1;
  userOperationSeq.set(profileIdStr, currentSeq);

  // 4. Update database presence if eligible
  try {
    const userProfile = await UserProfile.findById(profileIdStr);
    if (!userProfile) return;

    // Check race: If another operation occurred while awaiting DB read, abort stale write
    if (userOperationSeq.get(profileIdStr) !== currentSeq) {
      return;
    }

    // Suspension check: Suspended accounts cannot be Online
    if (userProfile.accountStatus === 'suspended') {
      return;
    }

    // Invisible check: Invisible users MUST remain offline
    if (userProfile.visibilityPreference === 'invisible') {
      return;
    }

    const wasOnline = Boolean(
      userProfile.isOnline &&
      userProfile.onlineUntil &&
      userProfile.onlineUntil > new Date()
    );

    // Eligible Online user: transition to Online with rolling future onlineUntil date
    userProfile.isOnline = true;
    userProfile.onlineUntil = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24hr rolling future date
    userProfile.lastSeen = new Date();
    await userProfile.save();

    if (userOperationSeq.get(profileIdStr) !== currentSeq) {
      return;
    }

    // Emit presence:update only on genuine transition to Online (not duplicate socket / unchanged online state)
    if (!wasOnline) {
      await broadcastPresenceUpdate(profileIdStr, true, userProfile.lastSeen, currentSeq);
    }
  } catch (err) {
    console.error(`[Presence] Error transitioning user ${profileIdStr} to Online:`, err);
  }
}

/**
 * Handles a socket disconnect event.
 */
export async function handleSocketDisconnect(socket, reason) {
  const profileIdStr = socketToUser.get(socket.id) || socket.data?.user?.profileId?.toString();
  socketToUser.delete(socket.id);

  if (!profileIdStr) return;

  // 1. Remove socket from user's active set
  const sockets = userSockets.get(profileIdStr);
  if (sockets) {
    sockets.delete(socket.id);
    if (sockets.size === 0) {
      userSockets.delete(profileIdStr);
    }
  }

  // 2. Multi-tab check: If other sockets remain connected, user stays Online
  if (userSockets.has(profileIdStr) && userSockets.get(profileIdStr).size > 0) {
    return;
  }

  // 3. Final socket disconnected: Schedule 30-second grace timer
  if (graceTimers.has(profileIdStr)) {
    const { timer } = graceTimers.get(profileIdStr);
    clearTimeout(timer);
    graceTimers.delete(profileIdStr);
  }

  const currentSeq = (userOperationSeq.get(profileIdStr) || 0) + 1;
  userOperationSeq.set(profileIdStr, currentSeq);

  const timer = setTimeout(async () => {
    try {
      await executeGraceDisconnect(profileIdStr, currentSeq);
    } catch (err) {
      console.error(`[Presence] Error during grace disconnect for user ${profileIdStr}:`, err);
    }
  }, defaultGracePeriodMs);

  graceTimers.set(profileIdStr, { timer, seq: currentSeq });
}

/**
 * Executes the offline transition when a grace period expires without reconnection.
 */
async function executeGraceDisconnect(profileIdStr, scheduledSeq) {
  graceTimers.delete(profileIdStr);

  // If a new socket reconnected while timer was running, abort!
  if (userSockets.has(profileIdStr) && userSockets.get(profileIdStr).size > 0) {
    return;
  }

  // If a newer operation sequence was issued, abort!
  if (userOperationSeq.get(profileIdStr) !== scheduledSeq) {
    return;
  }

  try {
    const userProfile = await UserProfile.findById(profileIdStr);
    if (!userProfile) return;

    // Final race check before writing to DB
    if (userSockets.has(profileIdStr) && userSockets.get(profileIdStr).size > 0) {
      return;
    }
    if (userOperationSeq.get(profileIdStr) !== scheduledSeq) {
      return;
    }

    const wasOnline = Boolean(
      userProfile.isOnline &&
      userProfile.onlineUntil &&
      userProfile.onlineUntil > new Date() &&
      userProfile.visibilityPreference !== 'invisible'
    );

    userProfile.isOnline = false;
    userProfile.onlineUntil = null;
    userProfile.lastSeen = new Date();
    await userProfile.save();

    if (userOperationSeq.get(profileIdStr) !== scheduledSeq) {
      return;
    }

    if (wasOnline) {
      await broadcastPresenceUpdate(profileIdStr, false, userProfile.lastSeen, scheduledSeq);
    }
  } catch (err) {
    console.error(`[Presence] Failed to mark user ${profileIdStr} offline:`, err);
  }
}

/**
 * Handles explicit logout from a socket or client.
 */
export async function handleExplicitLogout(profileId, socketId) {
  if (!profileId) return;
  const profileIdStr = profileId.toString();

  // 1. Close specific socket promptly if provided
  if (socketId) {
    socketToUser.delete(socketId);
    const sockets = userSockets.get(profileIdStr);
    if (sockets) {
      sockets.delete(socketId);
      if (sockets.size === 0) {
        userSockets.delete(profileIdStr);
      }
    }
    const io = getIO();
    if (io) {
      const s = io.sockets.sockets.get(socketId);
      if (s) {
        s.disconnect(true);
      }
    }
  }

  // 2. Multi-tab check: If another eligible authenticated socket remains connected, do NOT mark offline
  if (userSockets.has(profileIdStr) && userSockets.get(profileIdStr).size > 0) {
    return;
  }

  // 3. No other sockets remain: Cancel any grace timer and mark offline immediately
  if (graceTimers.has(profileIdStr)) {
    const { timer } = graceTimers.get(profileIdStr);
    clearTimeout(timer);
    graceTimers.delete(profileIdStr);
  }

  const currentSeq = (userOperationSeq.get(profileIdStr) || 0) + 1;
  userOperationSeq.set(profileIdStr, currentSeq);

  try {
    const userProfile = await UserProfile.findById(profileIdStr);
    if (!userProfile) return;

    const wasOnline = Boolean(
      userProfile.isOnline &&
      userProfile.onlineUntil &&
      userProfile.onlineUntil > new Date() &&
      userProfile.visibilityPreference !== 'invisible'
    );

    userProfile.isOnline = false;
    userProfile.onlineUntil = null;
    userProfile.lastSeen = new Date();
    await userProfile.save();

    if (userOperationSeq.get(profileIdStr) !== currentSeq) return;

    if (wasOnline) {
      await broadcastPresenceUpdate(profileIdStr, false, userProfile.lastSeen, currentSeq);
    }
  } catch (err) {
    console.error(`[Presence] Error during explicit logout for user ${profileIdStr}:`, err);
  }
}

/**
 * Handles explicit offline request from REST endpoint.
 */
export async function handleExplicitOffline(profileId, wasOnline = true, lastSeen = new Date()) {
  if (!profileId) return;
  const profileIdStr = profileId.toString();

  if (graceTimers.has(profileIdStr)) {
    const { timer } = graceTimers.get(profileIdStr);
    clearTimeout(timer);
    graceTimers.delete(profileIdStr);
  }

  const currentSeq = (userOperationSeq.get(profileIdStr) || 0) + 1;
  userOperationSeq.set(profileIdStr, currentSeq);

  if (wasOnline) {
    await broadcastPresenceUpdate(profileIdStr, false, lastSeen, currentSeq);
  }
}

/**
 * Handles account suspension event for presence.
 */
export async function handleSuspension(profileId) {
  if (!profileId) return;
  const profileIdStr = profileId.toString();

  if (graceTimers.has(profileIdStr)) {
    const { timer } = graceTimers.get(profileIdStr);
    clearTimeout(timer);
    graceTimers.delete(profileIdStr);
  }

  userSockets.delete(profileIdStr);

  const currentSeq = (userOperationSeq.get(profileIdStr) || 0) + 1;
  userOperationSeq.set(profileIdStr, currentSeq);

  try {
    const userProfile = await UserProfile.findById(profileIdStr);
    if (!userProfile) return;

    const wasOnline = Boolean(
      userProfile.isOnline &&
      userProfile.onlineUntil &&
      userProfile.onlineUntil > new Date() &&
      userProfile.visibilityPreference !== 'invisible'
    );

    userProfile.isOnline = false;
    userProfile.onlineUntil = null;
    userProfile.lastSeen = new Date();
    await userProfile.save();

    if (userOperationSeq.get(profileIdStr) !== currentSeq) return;

    if (wasOnline) {
      await broadcastPresenceUpdate(profileIdStr, false, userProfile.lastSeen, currentSeq);
    }
  } catch (err) {
    console.error(`[Presence] Error during suspension cleanup for ${profileIdStr}:`, err);
  }
}
