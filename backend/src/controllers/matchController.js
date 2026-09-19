import UserProfile from '../models/UserProfile.js';
import { findMatches } from '../services/matchingService.js';

export const getMatches = async (req, res) => {
  try {
    const firebaseUid = req.user.uid;

    // 1. Load current user's profile
    const currentUserProfile = await UserProfile.findOne({ firebaseUid });
    if (!currentUserProfile || !currentUserProfile.games || currentUserProfile.games.length === 0) {
      return res.status(404).json({ message: 'Complete your profile to discover teammates.' });
    }

    // 2. Load other eligible user profiles (excluding the current user)
    const allProfiles = await UserProfile.find({ firebaseUid: { $ne: firebaseUid } });

    const selectedGame = req.query.game;

    // 3. Process through matching engine
    const matches = findMatches(currentUserProfile, allProfiles, selectedGame);

    // 4. Return the sorted candidates
    res.status(200).json({ matches });
  } catch (error) {
    console.error('Error fetching matches:', error);
    res.status(500).json({ message: 'Internal server error while fetching matches.' });
  }
};
