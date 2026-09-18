import UserProfile from '../models/UserProfile.js';

export const getProfile = async (req, res) => {
  try {
    const { uid } = req.user;
    const userProfile = await UserProfile.findOne({ firebaseUid: uid });
    
    if (!userProfile) {
      return res.status(404).json({ message: 'Profile not found' });
    }
    
    return res.status(200).json(userProfile);
  } catch (error) {
    console.error('Error fetching profile:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const { uid, email } = req.user;
    const updateData = req.body;
    
    // Validate supported games
    const supportedGames = ['BGMI', 'Valorant', 'Brawl Stars'];
    if (updateData.games && Array.isArray(updateData.games)) {
      for (const game of updateData.games) {
        if (!supportedGames.includes(game.gameName)) {
          return res.status(400).json({ message: `Unsupported game: ${game.gameName}` });
        }
        if (!game.inGameName) {
          return res.status(400).json({ message: `In-game name is required for ${game.gameName}` });
        }
      }
    }

    // Ensure users cannot change identity fields
    delete updateData.firebaseUid;
    delete updateData.email;
    
    // Find and update, or create if it doesn't exist (though it should exist from auth verification)
    let userProfile = await UserProfile.findOneAndUpdate(
      { firebaseUid: uid },
      { $set: updateData },
      { new: true, runValidators: true }
    );
    
    if (!userProfile) {
      // Fallback: create if missing
      userProfile = new UserProfile({
        firebaseUid: uid,
        email: email || '',
        displayName: updateData.displayName || 'Gamer',
        games: updateData.games || [],
        connections: [],
        teams: []
      });
      await userProfile.save();
    }
    
    return res.status(200).json(userProfile);
  } catch (error) {
    console.error('Error updating profile:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};
