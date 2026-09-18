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
      return res.status(403).json({ message: 'You can only rate accepted connections.' });
    }

    // 24-hour rate limit for rating the SAME user
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentRating = await Rating.findOne({
      rater: raterProfile._id,
      ratedUser: ratedUserId,
      createdAt: { $gte: oneDayAgo }
    });

    if (recentRating) {
      return res.status(429).json({ message: 'You can only rate this player once every 24 hours.' });
    }

    // Create the rating
    const newRating = new Rating({
      rater: raterProfile._id,
      ratedUser: ratedUserId,
      overall,
      communication,
      teamwork,
      reliability,
      sportsmanship,
      feedback
    });

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
