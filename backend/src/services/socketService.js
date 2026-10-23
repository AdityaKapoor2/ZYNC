import UserProfile from '../models/UserProfile.js';
import { getIO } from '../config/socket.js';
import {
  handleSocketConnect,
  handleSocketDisconnect,
  handleExplicitLogout,
  handleSuspension
} from './presenceManager.js';

export const MANAGED_PREFIXES = ['user:', 'team:', 'admin:'];

/**
 * Returns the authorized list of rooms for a given user profile.
 */
export function getDesiredRooms(userProfile) {
  if (!userProfile || !userProfile._id) {
    return [];
  }
  const profileId = userProfile._id.toString();
  const rooms = [`official:${profileId}`];

  if (userProfile.accountStatus === 'active') {
    rooms.push(`user:${profileId}`);
    if (userProfile.role === 'super_admin') {
      rooms.push('admin:staff');
    }
  }

  return rooms;
}

/**
 * Sets up rooms and guards against status race conditions upon new socket connection.
 */
export async function setupSocketConnection(socket) {
  const profileId = socket.data?.user?.profileId;
  const handshakeStatus = socket.data?.user?.accountStatus;

  if (!profileId) {
    socket.disconnect(true);
    return;
  }

  // Attach disconnect and logout lifecycle handlers immediately to prevent missed events
  socket.on('disconnect', async (reason) => {
    try {
      await handleSocketDisconnect(socket, reason);
    } catch (err) {
      console.error('[Socket] Disconnect presence handling failed:', err);
    }
  });

  socket.on('auth:logout', async () => {
    try {
      await handleExplicitLogout(profileId, socket.id);
    } catch (err) {
      console.error('[Socket] Logout handling failed:', err);
    }
  });

  const freshProfile = await UserProfile.findById(profileId)
    .select('_id firebaseUid role accountStatus')
    .lean();

  if (!freshProfile) {
    socket.disconnect(true);
    return;
  }

  const desiredRooms = getDesiredRooms(freshProfile);
  await socket.join(desiredRooms);

  // Post-join verification guard to handle status changes racing with handshake
  const verifiedProfile = await UserProfile.findById(freshProfile._id)
    .select('accountStatus')
    .lean();

  const finalStatus = verifiedProfile?.accountStatus || freshProfile.accountStatus;

  if (finalStatus === 'suspended') {
    await socket.leave(`user:${freshProfile._id}`);
    await socket.leave('admin:staff');
  } else {
    // Register authenticated active connection with presence manager
    await handleSocketConnect(socket);
  }

  if (socket.data?.user) {
    socket.data.user.accountStatus = finalStatus;
  }

  if (finalStatus !== handshakeStatus) {
    socket.emit('account:status_changed', { accountStatus: finalStatus });
  }
}

/**
 * Reconciles socket rooms and delivers status updates for a user after database commits.
 */
export async function syncSocketRooms(userId) {
  if (!userId) return;

  const freshProfile = await UserProfile.findById(userId)
    .select('_id firebaseUid role accountStatus')
    .lean();

  if (!freshProfile) return;

  if (freshProfile.accountStatus === 'suspended') {
    await handleSuspension(freshProfile._id);
  }

  const io = getIO();
  if (!io) return;

  const profileId = freshProfile._id.toString();
  const sockets = await io.in(`official:${profileId}`).fetchSockets();
  const desiredRooms = new Set(getDesiredRooms(freshProfile));

  for (const s of sockets) {
    // Leave any managed room that is no longer desired
    for (const room of s.rooms) {
      const isManaged = MANAGED_PREFIXES.some((prefix) => room.startsWith(prefix));
      if (isManaged && !desiredRooms.has(room)) {
        await s.leave(room);
      }
    }

    // Join any desired room not yet joined
    for (const room of desiredRooms) {
      if (!s.rooms.has(room)) {
        await s.join(room);
      }
    }

    if (s.data?.user) {
      s.data.user.accountStatus = freshProfile.accountStatus;
      s.data.user.role = freshProfile.role;
    }

    // Emit standardized status payload directly to the socket instance
    s.emit('account:status_changed', { accountStatus: freshProfile.accountStatus });
  }
}
