import mongoose from 'mongoose';

const reportSchema = new mongoose.Schema({
  reporter: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserProfile',
    required: true
  },
  reportedUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserProfile',
    required: true
  },
  reason: {
    type: String,
    required: true,
    enum: [
      'Toxic or abusive behavior',
      'Harassment',
      'Spam',
      'Threatening behavior',
      'Cheating/scamming',
      'Inappropriate messages',
      'Other'
    ]
  },
  description: {
    type: String,
    maxlength: 1000
  },
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation'
  },
  status: {
    type: String,
    enum: ['pending', 'reviewed', 'resolved', 'dismissed'],
    default: 'pending'
  },
  moderationAction: {
    type: String,
    enum: ['none', 'warning', 'reputation_penalty', 'suspension'],
    default: 'none'
  }
}, {
  timestamps: true
});

const Report = mongoose.model('Report', reportSchema);

export default Report;
