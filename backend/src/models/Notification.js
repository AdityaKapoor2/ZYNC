import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserProfile',
    required: true,
  },
  broadcastId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BroadcastNotification',
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
  read: {
    type: Boolean,
    default: false,
  }
}, { timestamps: true });

// Index for getting user's notifications quickly, sorted by newest
notificationSchema.index({ recipient: 1, createdAt: -1 });

// Enforce at most one notification per (broadcastId, recipient) for broadcast-generated notifications
notificationSchema.index(
  { broadcastId: 1, recipient: 1 },
  {
    unique: true,
    partialFilterExpression: { broadcastId: { $type: 'objectId' } }
  }
);

const Notification = mongoose.model('Notification', notificationSchema);

export default Notification;
