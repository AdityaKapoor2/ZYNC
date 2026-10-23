import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserProfile',
    required: true
  },
  senderRole: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  senderDisplayName: {
    type: String,
    trim: true
  },
  text: {
    type: String,
    required: true,
    trim: true,
    maxlength: 2000
  },
  seq: {
    type: Number,
    required: true,
    min: 1
  },
  clientMessageId: {
    type: String,
    required: true,
    trim: true
  }
}, {
  timestamps: true,
  autoIndex: false
});

messageSchema.index({ conversationId: 1, seq: 1 }, { unique: true });
messageSchema.index({ conversationId: 1, clientMessageId: 1 }, { unique: true });

const Message = mongoose.model('Message', messageSchema);

export default Message;
