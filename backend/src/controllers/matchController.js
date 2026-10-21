import UserProfile from '../models/UserProfile.js';
import { findMatches } from '../services/matchingService.js';
import { explainMatch } from '../services/geminiService.js';

export const getMatches = async (req, res) => {
  try {
    const firebaseUid = req.user.uid;

    // 1. Load current user's profile
    const currentUserProfile = await UserProfile.findOne({ firebaseUid });
    if (!currentUserProfile || !currentUserProfile.games || currentUserProfile.games.length === 0) {
      return res.status(404).json({ message: 'Complete your profile to discover teammates.' });
    }

    // 2. Load other eligible user profiles (excluding the current user, suspended users, admins, and existing connections)
    const excludeIds = [currentUserProfile._id, ...(currentUserProfile.connections || [])];
    const allProfiles = await UserProfile.find({
      _id: { $nin: excludeIds },
      accountStatus: 'active',
      role: { $ne: 'super_admin' }
    });

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

export const getMatchExplanation = async (req, res) => {
  try {
    const firebaseUid = req.user.uid;
    const { targetUserId } = req.params;

    const currentUserProfile = await UserProfile.findOne({ firebaseUid });
    if (!currentUserProfile) {
      return res.status(404).json({ message: 'User profile not found.' });
    }

    const targetProfile = await UserProfile.findById(targetUserId);
    if (!targetProfile) {
      return res.status(404).json({ message: 'Target user not found.' });
    }

    // Process through matching engine to get the breakdown
    const matches = findMatches(currentUserProfile, [targetProfile]);
    if (!matches || matches.length === 0) {
      return res.status(400).json({ message: 'Not a valid match.' });
    }

    const matchResult = matches[0];
    
    // Construct minimal data payload for Gemini
    const matchData = {
      user: {
        game: matchResult.game,
        skillLevel: currentUserProfile.games.find(g => g.gameName === matchResult.game)?.skillLevel,
        roles: currentUserProfile.games.find(g => g.gameName === matchResult.game)?.roles,
        availability: currentUserProfile.games.find(g => g.gameName === matchResult.game)?.availability,
        playstyle: currentUserProfile.games.find(g => g.gameName === matchResult.game)?.playstyle,
        communication: currentUserProfile.games.find(g => g.gameName === matchResult.game)?.communication,
        competitiveGoals: currentUserProfile.games.find(g => g.gameName === matchResult.game)?.competitiveGoals
      },
      candidate: {
        skillLevel: matchResult.skillLevel,
        roles: matchResult.roles,
        availability: matchResult.availability,
        playstyle: matchResult.playstyle,
        communication: matchResult.communication,
        competitiveGoals: matchResult.competitiveGoals
      },
      compatibilityBreakdown: matchResult.breakdown,
      compatibilityScore: matchResult.compatibilityScore
    };

    const explanation = await explainMatch(matchData);
    res.status(200).json({ explanation, available: true });
  } catch (error) {
    console.error('Error fetching match explanation:', error);
    // Even if Gemini fails, do not expose API error details. Keep fallback generic.
    res.status(200).json({ available: false, explanation: null });
  }
};
