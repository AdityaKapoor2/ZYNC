import UserProfile from '../models/UserProfile.js';

export const enforceActiveUser = async (req, res, next) => {
  try {
    const { uid } = req.user;
    if (!uid) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const userProfile = await UserProfile.findOne({ firebaseUid: uid });
    
    if (!userProfile) {
      return next();
    }

    // Bypass for super_admin to prevent accidental blocking of admin access
    if (userProfile.role === 'super_admin') {
      return next();
    }

    if (userProfile.accountStatus === 'suspended') {
      return res.status(403).json({ message: 'Account is suspended', code: 'ACCOUNT_SUSPENDED' });
    }

    next();
  } catch (error) {
    console.error('Active User enforcement error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};
