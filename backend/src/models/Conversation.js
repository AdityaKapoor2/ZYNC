import mongoose from 'mongoose';

const conversationSchema = new mongoose.Schema({
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserProfile',
    required: true
  }],
  lastMessage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  },
  lastMessageAt: {
    type: Date
  },
  isModeration: {
    type: Boolean,
    default: false
  },
  lastSeq: {
    type: Number,
    default: 0,
    min: 0,
    required: true
  },
  readState: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'UserProfile',
      required: true
    },
    lastReadSeq: {
      type: Number,
      default: 0,
      min: 0
    }
  }]
}, {
  timestamps: true
});

const Conversation = mongoose.model('Conversation', conversationSchema);

export default Conversation;
