import UserProfile from '../models/UserProfile.js';

export const verifySuperAdmin = async (req, res, next) => {
  try {
    const { uid } = req.user;

    if (!uid) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const userProfile = await UserProfile.findOne({ firebaseUid: uid });

    if (!userProfile) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    if (userProfile.role !== 'super_admin') {
      return res.status(403).json({ message: 'Forbidden' });
    }

    next();
  } catch (error) {
    console.error('Super Admin verification error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};
