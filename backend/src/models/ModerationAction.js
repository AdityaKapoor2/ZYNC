import mongoose from 'mongoose';

const moderationActionSchema = new mongoose.Schema({
  affectedUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserProfile',
    required: true
  },
  actionType: {
    type: String,
    enum: ['warning', 'temporary_suspension', 'permanent_suspension', 'report_dismissed'],
    required: true
  },
  reason: {
    type: String
  },
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserProfile',
    required: true
  },
  relatedReport: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Report'
  },
  expiresAt: {
    type: Date
  },
  notes: {
    type: String
  }
}, {
  timestamps: true // Gives createdAt and updatedAt
});

const ModerationAction = mongoose.model('ModerationAction', moderationActionSchema);

export default ModerationAction;
