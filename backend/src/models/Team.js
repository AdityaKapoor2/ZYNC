import mongoose from 'mongoose';

const teamSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  game: {
    type: String,
    required: true,
    enum: ['BGMI', 'Brawl Stars', 'Valorant'],
  },
  captain: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserProfile',
    required: true,
  },
  members: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserProfile'
  }]
}, { timestamps: true });

const Team = mongoose.model('Team', teamSchema);

export default Team;
