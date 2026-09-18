import mongoose from 'mongoose';

const ratingSchema = new mongoose.Schema({
  rater: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserProfile',
    required: true,
  },
  ratedUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserProfile',
    required: true,
  },
  overall: {
    type: Number,
    required: true,
    min: 1,
    max: 5,
  },
  communication: {
    type: Number,
    min: 1,
    max: 5,
  },
  teamwork: {
    type: Number,
    min: 1,
    max: 5,
  },
  reliability: {
    type: Number,
    min: 1,
    max: 5,
  },
  sportsmanship: {
    type: Number,
    min: 1,
    max: 5,
  },
  feedback: {
    type: String,
    trim: true,
    maxlength: 500,
  }
}, { timestamps: true });

ratingSchema.pre('save', function() {
  if (this.rater.equals(this.ratedUser)) {
    throw new Error('Users cannot rate themselves.');
  }
});

const Rating = mongoose.model('Rating', ratingSchema);

export default Rating;
