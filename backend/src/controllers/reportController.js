import Report from '../models/Report.js';
import UserProfile from '../models/UserProfile.js';
import Conversation from '../models/Conversation.js';

// Helper to get the current user profile from Firebase UID
const getCurrentProfile = async (uid) => {
  return await UserProfile.findOne({ firebaseUid: uid });
};

export const createReport = async (req, res) => {
  try {
    const { uid } = req.user;
    const { reportedUserId, reason, description, conversationId } = req.body;

    const currentUser = await getCurrentProfile(uid);
    if (!currentUser) return res.status(404).json({ message: 'Profile not found' });

    if (currentUser._id.toString() === reportedUserId) {
      return res.status(400).json({ message: 'Cannot report yourself' });
    }

    const reportedUser = await UserProfile.findById(reportedUserId);
    if (!reportedUser) return res.status(404).json({ message: 'Reported user not found' });

    if (!reason) {
      return res.status(400).json({ message: 'Report reason is required' });
    }

    // If a conversation context is provided, verify both users were in it
    if (conversationId) {
      const conversation = await Conversation.findById(conversationId);
      if (!conversation) {
        return res.status(404).json({ message: 'Conversation not found' });
      }
      
      const isReporterParticipant = conversation.participants.includes(currentUser._id);
      const isReportedParticipant = conversation.participants.includes(reportedUserId);
      
      if (!isReporterParticipant || !isReportedParticipant) {
        return res.status(403).json({ message: 'Cannot report from a conversation you both are not part of' });
      }
    }

    // Rate limiting / Spam prevention
    // Check if the same user has reported this same user for the same reason in the last 24 hours
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const existingReport = await Report.findOne({
      reporter: currentUser._id,
      reportedUser: reportedUserId,
      reason,
      createdAt: { $gte: oneDayAgo }
    });

    if (existingReport) {
      return res.status(429).json({ message: 'You have already reported this user for this reason recently' });
    }

    const report = new Report({
      reporter: currentUser._id,
      reportedUser: reportedUserId,
      reason,
      description: description?.trim() || '',
      conversationId: conversationId || undefined
    });

    await report.save();

    // IMPORTANT: As per instructions, we do NOT automatically decrease reputation here.
    // The report is just stored with 'pending' status for moderation.

    return res.status(201).json({ message: 'Report submitted successfully. Our moderation team will review it.' });
  } catch (error) {
    console.error('Error creating report:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};
