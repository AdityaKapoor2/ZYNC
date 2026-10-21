import mongoose from 'mongoose';

const broadcastNotificationSchema = new mongoose.Schema({
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserProfile',
    required: true,
  },
  audienceType: {
    type: String,
    enum: ['all', 'game', 'individual'],
    required: true,
  },
  targetGame: {
    type: String,
  },
  targetUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserProfile',
  },
  title: {
    type: String,
    required: true,
    trim: true,
  },
  message: {
    type: String,
    required: true,
    trim: true,
  },
  recipientCount: {
    type: Number,
    default: 0,
  }
}, { timestamps: true });

const BroadcastNotification = mongoose.model('BroadcastNotification', broadcastNotificationSchema);

export default BroadcastNotification;
