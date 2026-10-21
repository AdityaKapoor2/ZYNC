import mongoose from 'mongoose';
import Rating from '../models/Rating.js';
import UserProfile from '../models/UserProfile.js';
import Connection from '../models/Connection.js';

export const createRating = async (req, res) => {
  try {
    const raterFirebaseUid = req.user.uid;
    const { ratedUserId, overall, communication, teamwork, reliability, sportsmanship, feedback } = req.body;

    if (!overall || overall < 1 || overall > 5) {
      return res.status(400).json({ message: 'Overall rating must be between 1 and 5.' });
    }

    if (!ratedUserId || !mongoose.Types.ObjectId.isValid(ratedUserId)) {
      return res.status(400).json({ message: 'Invalid rated user ID format' });
    }

    const raterProfile = await UserProfile.findOne({ firebaseUid: raterFirebaseUid });
    if (!raterProfile) {
      return res.status(404).json({ message: 'Rater profile not found.' });
    }

    if (raterProfile._id.toString() === ratedUserId) {
      return res.status(400).json({ message: 'You cannot rate yourself.' });
    }

    const ratedUserProfile = await UserProfile.findById(ratedUserId);
    if (!ratedUserProfile) {
      return res.status(404).json({ message: 'Rated user profile not found.' });
    }

    // Ensure they have an accepted connection
    const connection = await Connection.findOne({
      status: 'accepted',
      $or: [
        { requester: raterProfile._id, recipient: ratedUserId },
        { requester: ratedUserId, recipient: raterProfile._id }
      ]
    });

    if (!connection) {
      return res.status(403).json({ message: 'You can only rate users you are connected with.' });
    }

    // 24-hour rate limit for rating the SAME user
    const recentRating = await Rating.findOne({
      rater: raterProfile._id,
      ratedUser: ratedUserId
    }).sort({ createdAt: -1 });

    if (recentRating) {
      const timeSinceLastRating = Date.now() - recentRating.createdAt.getTime();
      const cooldownPeriod = 24 * 60 * 60 * 1000;
      if (timeSinceLastRating < cooldownPeriod) {
        const remainingMs = cooldownPeriod - timeSinceLastRating;
        const remainingHours = Math.ceil(remainingMs / (1000 * 60 * 60));
        return res.status(429).json({ message: `You can rate this teammate again in ${remainingHours} hours.` });
      }
    }

    // Validate category ratings to prevent Mongoose errors
    const validateCategory = (val) => val === undefined || val === 0 || (val >= 1 && val <= 5);

    if (!validateCategory(communication) || !validateCategory(teamwork) || 
        !validateCategory(reliability) || !validateCategory(sportsmanship)) {
      return res.status(400).json({ message: 'Category ratings must be between 1 and 5.' });
    }

    const ratingData = {
      rater: raterProfile._id,
      ratedUser: ratedUserId,
      overall,
      feedback: feedback ? feedback.trim() : undefined
    };

    if (communication >= 1 && communication <= 5) ratingData.communication = communication;
    if (teamwork >= 1 && teamwork <= 5) ratingData.teamwork = teamwork;
    if (reliability >= 1 && reliability <= 5) ratingData.reliability = reliability;
    if (sportsmanship >= 1 && sportsmanship <= 5) ratingData.sportsmanship = sportsmanship;

    // Create the rating
    const newRating = new Rating(ratingData);

    await newRating.save();

    // Recalculate average reputation for the rated user using aggregation
    const result = await Rating.aggregate([
      { $match: { ratedUser: ratedUserProfile._id } },
      {
        $group: {
          _id: '$ratedUser',
          avgOverall: { $avg: '$overall' },
          avgCommunication: { $avg: '$communication' },
          avgTeamwork: { $avg: '$teamwork' },
          avgReliability: { $avg: '$reliability' },
          avgSportsmanship: { $avg: '$sportsmanship' },
          count: { $sum: 1 }
        }
      }
    ]);

    if (result.length > 0) {
      const stats = result[0];

      ratedUserProfile.reputation = {
        score: Number(stats.avgOverall.toFixed(1)),
        count: stats.count,
        categories: {
          communication: stats.avgCommunication ? Number(stats.avgCommunication.toFixed(1)) : 0,
          teamwork: stats.avgTeamwork ? Number(stats.avgTeamwork.toFixed(1)) : 0,
          reliability: stats.avgReliability ? Number(stats.avgReliability.toFixed(1)) : 0,
          sportsmanship: stats.avgSportsmanship ? Number(stats.avgSportsmanship.toFixed(1)) : 0
        }
      };

      await ratedUserProfile.save();
    }

    res.status(201).json({ message: 'Rating submitted successfully.', reputation: ratedUserProfile.reputation });

  } catch (error) {
    console.error('Error creating rating:', error);
    res.status(500).json({ message: 'Internal server error while creating rating.' });
  }
};
