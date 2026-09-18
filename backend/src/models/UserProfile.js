import mongoose from 'mongoose';

const gameProfileSchema = new mongoose.Schema({
  gameName: {
    type: String,
    enum: ['BGMI', 'Brawl Stars', 'Valorant'],
    required: true,
  },
  inGameName: {
    type: String,
    required: true,
  },
  skillLevel: {
    type: Number,
    min: 1,
    max: 100,
  },
  roles: [{
    type: String,
  }],
  availability: [{
    type: String, // e.g., 'Weekday Evenings', 'Weekends'
  }],
  playstyle: {
    type: String, // e.g., 'Aggressive', 'Passive'
  },
  communication: {
    type: String,
  },
  competitiveGoals: {
    type: String,
  }
});

const userProfileSchema = new mongoose.Schema({
  firebaseUid: {
    type: String,
    required: true,
    unique: true,
  },
  email: {
    type: String,
    required: true,
  },
  displayName: {
    type: String,
    required: true,
  },
  games: [gameProfileSchema],
  connections: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserProfile'
  }],
  teams: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Team'
  }]
}, { timestamps: true });

const UserProfile = mongoose.model('UserProfile', userProfileSchema);

export default UserProfile;
