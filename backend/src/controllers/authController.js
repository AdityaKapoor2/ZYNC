import UserProfile from '../models/UserProfile.js';

export const verifyAuth = async (req, res) => {
  try {
    // req.user is populated by the verifyToken middleware
    const { uid, email, name, picture } = req.user;

    // Check if the user exists in our DB
    let userProfile = await UserProfile.findOne({ firebaseUid: uid });

    if (!userProfile) {
      // Create a basic profile if they don't exist yet
      userProfile = new UserProfile({
        firebaseUid: uid,
        email: email || '',
        displayName: name || email?.split('@')[0] || 'Gamer',
        games: [],
        connections: [],
        teams: []
      });
      await userProfile.save();
    }

    return res.status(200).json({
      message: 'Authentication successful',
      user: {
        id: userProfile._id,
        firebaseUid: userProfile.firebaseUid,
        email: userProfile.email,
        displayName: userProfile.displayName
      }
    });

  } catch (error) {
    console.error('Verify auth error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};
