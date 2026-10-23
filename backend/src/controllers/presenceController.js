import UserProfile from '../models/UserProfile.js';
import { handleExplicitOffline, hasActiveConnections, broadcastPresenceUpdate } from '../services/presenceManager.js';

export const setOnline = async (req, res) => {
  try {
    const { uid } = req.user;
    
    const userProfile = await UserProfile.findOne({ firebaseUid: uid });
    if (!userProfile) {
      return res.status(404).json({ message: 'Profile not found' });
    }

    const visibilityPreference = userProfile.visibilityPreference || 'online';

    // Requirement 5: Ensure existing Online endpoint cannot override an Invisible preference
    if (visibilityPreference === 'invisible') {
      return res.status(200).json({
        isOnline: false,
        onlineUntil: null,
        lastSeen: userProfile.lastSeen,
        visibilityPreference: 'invisible'
      });
    }

    const wasOnline = Boolean(
      userProfile.isOnline &&
      userProfile.onlineUntil &&
      userProfile.onlineUntil > new Date()
    );

    // 30 minutes from now
    const onlineUntil = new Date(Date.now() + 30 * 60 * 1000);
    const lastSeen = new Date();

    userProfile.isOnline = true;
    userProfile.onlineUntil = onlineUntil;
    userProfile.lastSeen = lastSeen;
    await userProfile.save();

    if (!wasOnline) {
      await broadcastPresenceUpdate(userProfile._id, true, lastSeen);
    }

    res.status(200).json({
      isOnline: true,
      onlineUntil,
      lastSeen,
      visibilityPreference: 'online'
    });
  } catch (error) {
    console.error('Error setting online status:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const setOffline = async (req, res) => {
  try {
    const { uid } = req.user;
    
    const existingProfile = await UserProfile.findOne({ firebaseUid: uid });
    if (!existingProfile) {
      return res.status(404).json({ message: 'Profile not found' });
    }

    const wasOnline = Boolean(
      existingProfile.isOnline &&
      existingProfile.onlineUntil &&
      existingProfile.onlineUntil > new Date() &&
      existingProfile.visibilityPreference !== 'invisible'
    );

    const lastSeen = new Date();
    existingProfile.isOnline = false;
    existingProfile.onlineUntil = null;
    existingProfile.lastSeen = lastSeen;
    await existingProfile.save();

    await handleExplicitOffline(existingProfile._id, wasOnline, lastSeen);

    res.status(200).json({
      isOnline: false,
      onlineUntil: null,
      lastSeen,
      visibilityPreference: existingProfile.visibilityPreference || 'online'
    });
  } catch (error) {
    console.error('Error setting offline status:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const getPresence = async (req, res) => {
  try {
    const { uid } = req.user;
    
    const userProfile = await UserProfile.findOne({ firebaseUid: uid });

    if (!userProfile) {
      return res.status(404).json({ message: 'Profile not found' });
    }

    const visibilityPreference = userProfile.visibilityPreference || 'online';

    // Determine effective online status
    const now = new Date();
    const effectivelyOnline = visibilityPreference === 'invisible'
      ? false
      : Boolean(userProfile.isOnline && userProfile.onlineUntil && userProfile.onlineUntil > now);

    res.status(200).json({
      isOnline: effectivelyOnline,
      onlineUntil: visibilityPreference === 'invisible' ? null : userProfile.onlineUntil,
      lastSeen: userProfile.lastSeen,
      visibilityPreference
    });
  } catch (error) {
    console.error('Error getting presence status:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const setVisibilityPreference = async (req, res) => {
  try {
    const { uid } = req.user;

    const rawPreference = req.body?.visibilityPreference ?? req.body?.preference ?? req.body?.visibility;
    if (rawPreference === undefined || rawPreference === null) {
      return res.status(400).json({ message: 'visibilityPreference is required' });
    }

    if (typeof rawPreference !== 'string') {
      return res.status(400).json({ message: 'visibilityPreference must be a string' });
    }

    const preference = rawPreference.trim().toLowerCase();
    if (!['online', 'invisible'].includes(preference)) {
      return res.status(400).json({ 
        message: 'Invalid visibility preference. Allowed values are "online" and "invisible".' 
      });
    }

    const userProfile = await UserProfile.findOne({ firebaseUid: uid });
    if (!userProfile) {
      return res.status(404).json({ message: 'Profile not found' });
    }

    // Reject attempts to change another user's preference
    const requestedUserId = req.body?.userId ?? req.body?._id;
    if (requestedUserId && requestedUserId.toString() !== userProfile._id.toString()) {
      return res.status(403).json({ message: 'Cannot modify visibility preference of another user' });
    }
    const requestedFirebaseUid = req.body?.firebaseUid;
    if (requestedFirebaseUid && requestedFirebaseUid !== uid) {
      return res.status(403).json({ message: 'Cannot modify visibility preference of another user' });
    }

    const now = new Date();
    const wasOnline = Boolean(
      userProfile.isOnline &&
      userProfile.onlineUntil &&
      userProfile.onlineUntil > now &&
      userProfile.visibilityPreference !== 'invisible'
    );

    userProfile.visibilityPreference = preference;

    if (preference === 'invisible') {
      userProfile.isOnline = false;
      userProfile.onlineUntil = null;
      userProfile.lastSeen = new Date();
      await userProfile.save();
      await handleExplicitOffline(userProfile._id, wasOnline, userProfile.lastSeen);
    } else if (preference === 'online') {
      // If user currently has active socket connections, they can now become Online
      if (hasActiveConnections(userProfile._id)) {
        userProfile.isOnline = true;
        userProfile.onlineUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
        userProfile.lastSeen = new Date();
        await userProfile.save();
        await broadcastPresenceUpdate(userProfile._id, true, userProfile.lastSeen);
      } else {
        await userProfile.save();
      }
    }

    const effectivelyOnline = preference === 'invisible'
      ? false
      : Boolean(userProfile.isOnline && userProfile.onlineUntil && userProfile.onlineUntil > now);

    return res.status(200).json({
      visibilityPreference: userProfile.visibilityPreference,
      isOnline: effectivelyOnline,
      onlineUntil: preference === 'invisible' ? null : userProfile.onlineUntil,
      lastSeen: userProfile.lastSeen
    });
  } catch (error) {
    console.error('Error updating visibility preference:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};
