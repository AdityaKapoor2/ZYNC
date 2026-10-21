import mongoose from 'mongoose';

const ticketMessageSchema = new mongoose.Schema({
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserProfile',
    required: true,
  },
  senderRole: {
    type: String,
    enum: ['user', 'staff'],
    required: true,
  },
  senderDisplayName: {
    type: String,
    required: true,
    trim: true,
  },
  text: {
    type: String,
    required: true,
    trim: true,
    maxlength: 4000,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  }
});

const internalNoteSchema = new mongoose.Schema({
  staff: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserProfile',
    required: true,
  },
  staffDisplayName: {
    type: String,
    required: true,
    trim: true,
  },
  note: {
    type: String,
    required: true,
    trim: true,
    maxlength: 4000,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  }
});

const supportTicketSchema = new mongoose.Schema({
  ticketNumber: {
    type: String,
    unique: true,
    required: true,
    index: true,
  },
  creator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserProfile',
    required: true,
    index: true,
  },
  creatorEmail: {
    type: String,
    required: true,
    trim: true,
  },
  accountStatusAtCreation: {
    type: String,
    enum: ['active', 'suspended'],
    required: true,
  },
  category: {
    type: String,
    enum: [
      'account_access',
      'suspension_appeal',
      'billing',
      'bug_report',
      'harassment_inquiry',
      'general'
    ],
    required: true,
    index: true,
  },
  subject: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200,
  },
  status: {
    type: String,
    enum: ['open', 'in_progress', 'waiting_on_user', 'resolved', 'closed'],
    default: 'open',
    index: true,
  },
  priority: {
    type: String,
    enum: ['low', 'normal', 'high', 'urgent'],
    default: 'normal',
    index: true,
  },
  assignedStaff: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserProfile',
    default: null,
    index: true,
  },
  messages: [ticketMessageSchema],
  internalNotes: [internalNoteSchema],
  relatedModerationAction: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ModerationAction',
    default: null,
  },
  resolvedAt: {
    type: Date,
    default: null,
  }
}, {
  timestamps: true,
});

// Helper for atomic counter / uniqueness generator
supportTicketSchema.statics.generateTicketNumber = async function () {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  let isUnique = false;
  let candidate = '';
  let attempts = 0;
  while (!isUnique && attempts < 10) {
    attempts++;
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    candidate = `TCK-${dateStr}-${randomSuffix}`;
    const existing = await this.findOne({ ticketNumber: candidate });
    if (!existing) {
      isUnique = true;
    }
  }
  return candidate;
};

// Sanitizer for user-facing responses (strips internal notes and sensitive refs)
supportTicketSchema.methods.toUserDTO = function () {
  return {
    _id: this._id,
    ticketNumber: this.ticketNumber,
    creator: this.creator,
    creatorEmail: this.creatorEmail,
    category: this.category,
    subject: this.subject,
    status: this.status,
    priority: this.priority,
    messages: this.messages || [],
    hasRelatedModerationAction: !!this.relatedModerationAction,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
    resolvedAt: this.resolvedAt,
  };
};

// Staff response DTO (includes internal notes and staff assignment)
supportTicketSchema.methods.toStaffDTO = function () {
  return {
    _id: this._id,
    ticketNumber: this.ticketNumber,
    creator: this.creator,
    creatorEmail: this.creatorEmail,
    accountStatusAtCreation: this.accountStatusAtCreation,
    category: this.category,
    subject: this.subject,
    status: this.status,
    priority: this.priority,
    assignedStaff: this.assignedStaff,
    messages: this.messages || [],
    internalNotes: this.internalNotes || [],
    relatedModerationAction: this.relatedModerationAction,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
    resolvedAt: this.resolvedAt,
  };
};

const SupportTicket = mongoose.model('SupportTicket', supportTicketSchema);

export default SupportTicket;
