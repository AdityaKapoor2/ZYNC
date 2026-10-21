import UserProfile from '../models/UserProfile.js';
import Connection from '../models/Connection.js';
import Report from '../models/Report.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import ModerationAction from '../models/ModerationAction.js';
import Notification from '../models/Notification.js';
import mongoose from 'mongoose';

// Helper to escape special regex characters for literal matching
const escapeRegex = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const getUsers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    // enforce hard limit
    const safeLimit = Math.min(limit, 100);
    const skip = (page - 1) * safeLimit;

    // Build query based on search and filters
    const query = {};

    if (req.query.search !== undefined) {
      if (typeof req.query.search !== 'string') {
        return res.status(400).json({ message: 'Search query must be a string' });
      }

      const trimmedSearch = req.query.search.trim();
      if (trimmedSearch.length > 100) {
        return res.status(400).json({ message: 'Search query exceeds maximum length of 100 characters' });
      }

      if (trimmedSearch.length > 0) {
        const searchRegex = new RegExp(escapeRegex(trimmedSearch), 'i');
        query.$or = [
          { displayName: searchRegex },
          { email: searchRegex }
        ];
      }
    }

    if (req.query.status) {
      if (!['active', 'suspended'].includes(req.query.status)) {
        return res.status(400).json({ message: 'Invalid status filter' });
      }
      query.accountStatus = req.query.status;
    }

    if (req.query.role) {
      if (!['user', 'super_admin'].includes(req.query.role)) {
        return res.status(400).json({ message: 'Invalid role filter' });
      }
      query.role = req.query.role;
    }

    if (req.query.game) {
      query['games.gameName'] = req.query.game;
    }

    const total = await UserProfile.countDocuments(query);
    const users = await UserProfile.find(query)
      .select('displayName email role accountStatus games reputation isOnline lastSeen createdAt updatedAt')
      .skip(skip)
      .limit(safeLimit)
      .lean();

    res.status(200).json({
      users,
      total,
      page,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit)
    });
  } catch (err) {
    console.error('getUsers error', err);
    res.status(500).json({ message: 'Failed to retrieve users' });
  }
};

export const getUserDetails = async (req, res) => {
  try {
    const user = await UserProfile.findById(req.params.id).lean();
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Optionally get connection count
    const connectionsCount = await Connection.countDocuments({
      $or: [{ requester: user._id }, { recipient: user._id }],
      status: 'accepted'
    });

    const userDetails = {
      _id: user._id,
      displayName: user.displayName,
      email: user.email,
      role: user.role,
      accountStatus: user.accountStatus,
      games: user.games,
      reputation: user.reputation,
      isOnline: user.isOnline,
      lastSeen: user.lastSeen,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      connectionsCount
    };

    res.status(200).json(userDetails);
  } catch (err) {
    console.error('getUserDetails error', err);
    res.status(500).json({ message: 'Failed to retrieve user details' });
  }
};

export const updateUserStatus = async (req, res) => {
  try {
    const { status } = req.body;

    if (!['active', 'suspended'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const targetUser = await UserProfile.findById(req.params.id);
    if (!targetUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Rule 1: Super admin cannot suspend themselves
    // req.user has the UID from the Firebase token
    if (targetUser.firebaseUid === req.user.uid && status === 'suspended') {
      return res.status(400).json({ message: 'Cannot suspend your own account' });
    }

    targetUser.accountStatus = status;
    await targetUser.save();

    res.status(200).json({ message: `User status updated to ${status}`, user: targetUser });
  } catch (err) {
    console.error('updateUserStatus error', err);
    res.status(500).json({ message: 'Failed to update user status' });
  }
};

export const getReports = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const safeLimit = Math.min(limit, 100);
    const skip = (page - 1) * safeLimit;

    const query = {};

    if (req.query.status) {
      if (!['pending', 'reviewed', 'resolved', 'dismissed'].includes(req.query.status)) {
        return res.status(400).json({ message: 'Invalid status filter' });
      }
      query.status = req.query.status;
    }

    if (req.query.reason) {
      const validReasons = [
        'Toxic or abusive behavior',
        'Harassment',
        'Spam',
        'Threatening behavior',
        'Cheating/scamming',
        'Inappropriate messages',
        'Other'
      ];
      if (!validReasons.includes(req.query.reason)) {
        return res.status(400).json({ message: 'Invalid reason filter' });
      }
      query.reason = req.query.reason;
    }

    if (req.query.reportedUser) {
      query.reportedUser = req.query.reportedUser;
    }

    if (req.query.reporter) {
      query.reporter = req.query.reporter;
    }

    // Deferred search parameter since it requires large architectural change (Mongoose aggregation) to search securely across populated fields

    const total = await Report.countDocuments(query);
    const reportsRaw = await Report.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .populate('reporter', '_id displayName email')
      .populate('reportedUser', '_id displayName email')
      .lean();

    const reports = reportsRaw.map(report => {
      const evidenceMessageCount = report.evidenceMessages ? report.evidenceMessages.length : 0;
      const { evidenceMessages, ...rest } = report;
      return {
        ...rest,
        evidenceMessageCount
      };
    });

    res.status(200).json({
      reports,
      pagination: {
        page,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit)
      }
    });
  } catch (err) {
    console.error('getReports error', err);
    res.status(500).json({ message: 'Failed to retrieve reports' });
  }
};

export const getReportDetails = async (req, res) => {
  try {
    const report = await Report.findById(req.params.id)
      .populate('reporter', '_id displayName email')
      .populate('reportedUser', '_id displayName email')
      .lean();

    if (!report) {
      return res.status(404).json({ message: 'Report not found' });
    }

    const moderationActions = await ModerationAction.find({ relatedReport: report._id })
      .populate('admin', '_id displayName email')
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({ ...report, moderationActions });
  } catch (err) {
    console.error('getReportDetails error', err);
    res.status(500).json({ message: 'Failed to retrieve report details' });
  }
};

export const updateReportStatus = async (req, res) => {
  try {
    const { status } = req.body;

    if (!status || !['pending', 'reviewed', 'resolved', 'dismissed'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const report = await Report.findById(req.params.id);
    if (!report) {
      return res.status(404).json({ message: 'Report not found' });
    }

    const currentStatus = report.status;
    let validTransition = false;

    if (currentStatus === 'pending' && status === 'reviewed') validTransition = true;
    if (currentStatus === 'reviewed' && (status === 'resolved' || status === 'dismissed')) validTransition = true;

    if (!validTransition) {
      return res.status(400).json({ message: `Cannot change status from ${currentStatus} to ${status}` });
    }

    report.status = status;
    await report.save();

    const populatedReport = await Report.findById(report._id)
      .populate('reporter', '_id displayName email')
      .populate('reportedUser', '_id displayName email')
      .lean();

    res.status(200).json({ message: `Report status updated to ${status}`, report: populatedReport });
  } catch (err) {
    console.error('updateReportStatus error', err);
    res.status(500).json({ message: 'Failed to update report status' });
  }
};

export const messageReportUser = async (req, res) => {
  try {
    const { id: reportId } = req.params;
    const { recipientType, message } = req.body;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ message: 'Message cannot be empty' });
    }

    if (message.length > 2000) {
      return res.status(400).json({ message: 'Message exceeds maximum length' });
    }

    if (!['reporter', 'reportedUser'].includes(recipientType)) {
      return res.status(400).json({ message: 'Invalid recipientType' });
    }

    const report = await Report.findById(reportId);
    if (!report) {
      return res.status(404).json({ message: 'Report not found' });
    }

    let adminId = req.user._id;
    if (!adminId) {
      const adminProfile = await UserProfile.findOne({ firebaseUid: req.user.uid });
      if (!adminProfile) {
        return res.status(403).json({ message: 'Admin profile not found' });
      }
      adminId = adminProfile._id;
    }

    const targetUserId = recipientType === 'reporter' ? report.reporter : report.reportedUser;

    if (!targetUserId) {
      return res.status(400).json({ message: 'Report does not have the specified recipient' });
    }

    if (targetUserId.toString() === adminId.toString()) {
      return res.status(400).json({ message: 'Cannot message yourself' });
    }

    const targetUser = await UserProfile.findById(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ message: 'Target user not found' });
    }

    let conversation = await Conversation.findOne({
      participants: { $all: [adminId, targetUserId], $size: 2 },
      isModeration: true
    });

    if (!conversation) {
      const existingConv = await Conversation.findOne({
        participants: { $all: [adminId, targetUserId], $size: 2 }
      });
      if (existingConv) {
        existingConv.isModeration = true;
        await existingConv.save();
        conversation = existingConv;
      }
    }

    if (!conversation) {
      conversation = new Conversation({
        participants: [adminId, targetUserId],
        isModeration: true
      });
      await conversation.save();
    }

    const newMessage = new Message({
      conversationId: conversation._id,
      sender: adminId,
      senderRole: 'admin',
      senderDisplayName: 'ZYNC Super Admin',
      text: message.trim()
    });

    await newMessage.save();

    conversation.lastMessage = newMessage._id;
    conversation.lastMessageAt = newMessage.createdAt;
    await conversation.save();

    return res.status(201).json({ message: 'Message sent', conversationId: conversation._id });
  } catch (err) {
    console.error('messageReportUser error', err);
    res.status(500).json({ message: 'Failed to message user' });
  }
};

export const createModerationAction = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const { affectedUserId, actionType, reason, relatedReportId, expiresAt, notes } = req.body;

    if (!actionType || !['warning', 'temporary_suspension', 'permanent_suspension', 'report_dismissed'].includes(actionType)) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Invalid or missing actionType' });
    }

    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Reason is required' });
    }

    let targetUserId = affectedUserId;
    let relatedReport = null;

    if (relatedReportId) {
      relatedReport = await Report.findById(relatedReportId).session(session);
      if (!relatedReport) {
        await session.abortTransaction();
        return res.status(404).json({ message: 'Related report not found' });
      }

      // Ensure the affected user is actually involved (must be the reportedUser)
      if (!targetUserId) {
        targetUserId = relatedReport.reportedUser.toString();
      } else if (relatedReport.reportedUser.toString() !== targetUserId.toString()) {
        await session.abortTransaction();
        return res.status(400).json({ message: 'Affected user must be the reported user of this report' });
      }
    }

    if (!targetUserId) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'affectedUserId is required' });
    }

    if (actionType === 'report_dismissed') {
      if (!relatedReport) {
        await session.abortTransaction();
        return res.status(400).json({ message: 'report_dismissed requires a related report' });
      }
    }

    const adminProfile = await UserProfile.findOne({ firebaseUid: req.user.uid });
    if (!adminProfile) {
      await session.abortTransaction();
      return res.status(403).json({ message: 'Admin profile not found' });
    }

    if (targetUserId.toString() === adminProfile._id.toString()) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Cannot moderate yourself' });
    }

    const affectedUser = await UserProfile.findById(targetUserId).session(session);
    if (!affectedUser) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'Affected user not found' });
    }

    // Prevent duplicate action from accidental double-submission
    if (relatedReportId) {
      const existingActionOnReport = await ModerationAction.findOne({
        relatedReport: relatedReportId,
        actionType
      }).session(session);

      if (existingActionOnReport) {
        await session.abortTransaction();
        return res.status(409).json({ message: `A ${actionType} action has already been applied for this report`, action: existingActionOnReport });
      }
    } else {
      const recentDuplicate = await ModerationAction.findOne({
        affectedUser: targetUserId,
        actionType,
        reason: reason.trim(),
        createdAt: { $gte: new Date(Date.now() - 5000) }
      }).session(session);

      if (recentDuplicate) {
        await session.abortTransaction();
        return res.status(409).json({ message: 'Duplicate moderation action detected', action: recentDuplicate });
      }
    }

    if (actionType === 'temporary_suspension') {
      if (!expiresAt) {
        await session.abortTransaction();
        return res.status(400).json({ message: 'temporary_suspension requires expiresAt' });
      }
      if (new Date(expiresAt) <= new Date()) {
        await session.abortTransaction();
        return res.status(400).json({ message: 'expiresAt must be in the future' });
      }
    }

    // Apply the action
    const action = new ModerationAction({
      affectedUser: targetUserId,
      actionType,
      reason: reason.trim(),
      admin: adminProfile._id,
      relatedReport: relatedReportId || undefined,
      expiresAt: actionType === 'temporary_suspension' ? expiresAt : undefined,
      notes: notes ? notes.trim() : undefined
    });

    await action.save({ session });

    if (actionType === 'temporary_suspension' || actionType === 'permanent_suspension') {
      affectedUser.accountStatus = 'suspended';
      await affectedUser.save({ session });
    }

    if (relatedReport) {
      if (actionType === 'report_dismissed') {
        relatedReport.status = 'dismissed';
        relatedReport.moderationAction = 'none';
      } else {
        relatedReport.status = 'resolved';
        if (actionType === 'warning') {
          relatedReport.moderationAction = 'warning';
        } else if (actionType === 'temporary_suspension' || actionType === 'permanent_suspension') {
          relatedReport.moderationAction = 'suspension';
        }
      }
      await relatedReport.save({ session });
    }

    let warningNotification = null;
    if (actionType === 'warning') {
      warningNotification = new Notification({
        recipient: affectedUser._id,
        title: 'Official Moderation Warning',
        message: `ZYNC Moderation has issued an official warning regarding your account: "${reason.trim()}". Please review our Community Guidelines to ensure a safe, respectful environment for all players.`,
        read: false
      });
      await warningNotification.save({ session });
    }

    await session.commitTransaction();
    res.status(201).json({
      message: 'Moderation action created',
      action,
      report: relatedReport,
      notification: warningNotification
    });
  } catch (err) {
    await session.abortTransaction();
    console.error('createModerationAction error', err);
    res.status(500).json({ message: 'Failed to create moderation action' });
  } finally {
    session.endSession();
  }
};

export const getModerationActions = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    const query = {};
    if (req.query.affectedUser) query.affectedUser = req.query.affectedUser;
    if (req.query.actionType) query.actionType = req.query.actionType;
    if (req.query.relatedReport) query.relatedReport = req.query.relatedReport;

    const total = await ModerationAction.countDocuments(query);
    const actions = await ModerationAction.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('affectedUser', 'displayName email')
      .populate('admin', 'displayName email')
      .lean();

    res.status(200).json({
      actions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error('getModerationActions error', err);
    res.status(500).json({ message: 'Failed to retrieve moderation actions' });
  }
};

export const getModerationActionDetails = async (req, res) => {
  try {
    const action = await ModerationAction.findById(req.params.id)
      .populate('affectedUser', 'displayName email accountStatus')
      .populate('admin', 'displayName email')
      .populate('relatedReport')
      .lean();

    if (!action) return res.status(404).json({ message: 'Moderation action not found' });

    res.status(200).json(action);
  } catch (err) {
    console.error('getModerationActionDetails error', err);
    res.status(500).json({ message: 'Failed to retrieve moderation action details' });
  }
};
