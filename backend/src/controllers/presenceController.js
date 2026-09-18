import UserProfile from '../models/UserProfile.js';

export const setOnline = async (req, res) => {
  try {
    const { uid } = req.user;
    
    // 30 minutes from now
    const onlineUntil = new Date(Date.now() + 30 * 60 * 1000);
    const lastSeen = new Date();

    const userProfile = await UserProfile.findOneAndUpdate(
      { firebaseUid: uid },
      { 
        $set: { 
          isOnline: true,
          onlineUntil,
          lastSeen
        } 
      },
      { new: true }
    );

    if (!userProfile) {
      return res.status(404).json({ message: 'Profile not found' });
    }

    res.status(200).json({
      isOnline: true,
      onlineUntil,
      lastSeen
    });
  } catch (error) {
    console.error('Error setting online status:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const setOffline = async (req, res) => {
  try {
    const { uid } = req.user;
    
    const lastSeen = new Date();

    const userProfile = await UserProfile.findOneAndUpdate(
      { firebaseUid: uid },
      { 
        $set: { 
          isOnline: false,
          onlineUntil: null,
          lastSeen
        } 
      },
      { new: true }
    );

    if (!userProfile) {
      return res.status(404).json({ message: 'Profile not found' });
    }

    res.status(200).json({
      isOnline: false,
      onlineUntil: null,
      lastSeen
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

    // Determine effective online status
    const now = new Date();
    const effectivelyOnline = userProfile.isOnline && userProfile.onlineUntil && userProfile.onlineUntil > now;

    res.status(200).json({
      isOnline: effectivelyOnline,
      onlineUntil: userProfile.onlineUntil,
      lastSeen: userProfile.lastSeen
    });
  } catch (error) {
    console.error('Error getting presence status:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
