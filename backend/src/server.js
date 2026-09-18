import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import connectDB from './config/db.js';
import authRoutes from './routes/authRoutes.js';
import profileRoutes from './routes/profileRoutes.js';

dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Connect to Database
if (process.env.MONGODB_URI) {
  connectDB();
} else {
  console.warn('MONGODB_URI not found in environment variables. Database not connected.');
}

// Routes
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'ZYNC API is running' });
});

app.use('/api/auth', authRoutes);
app.use('/api/profiles', profileRoutes);

import matchRoutes from './routes/matchRoutes.js';
import connectionRoutes from './routes/connectionRoutes.js';

// We will import and use other routes here
app.use('/api/matches', matchRoutes);
app.use('/api/connections', connectionRoutes);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
