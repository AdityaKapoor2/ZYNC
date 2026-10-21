import express from 'express';
import cors from 'cors';
import { getCorsOptions } from './config/cors.js';

import authRoutes from './routes/authRoutes.js';
import profileRoutes from './routes/profileRoutes.js';
import matchRoutes from './routes/matchRoutes.js';
import connectionRoutes from './routes/connectionRoutes.js';
import presenceRoutes from './routes/presenceRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import reportRoutes from './routes/reportRoutes.js';
import ratingRoutes from './routes/ratingRoutes.js';
import supportRoutes from './routes/supportRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import adminRoutes from './routes/adminRoutes.js';

/**
 * Factory function to create an Express app instance with configured CORS and routes.
 * Supports optional custom CORS options for isolated testing across environments.
 */
export const createApp = (customCorsOptions) => {
  const app = express();

  // Middleware - CORS must precede express.json() and route definitions
  const corsOptions = customCorsOptions || getCorsOptions();
  app.use(cors(corsOptions));
  app.use(express.json());

  // Health check
  app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok', message: 'ZYNC API is running' });
  });

  // API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/profiles', profileRoutes);
  app.use('/api/matches', matchRoutes);
  app.use('/api/connections', connectionRoutes);
  app.use('/api/presence', presenceRoutes);
  app.use('/api/chat', chatRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/ratings', ratingRoutes);
  app.use('/api/support', supportRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/admin', adminRoutes);

  return app;
};

// Default singleton app instance for runtime use
const app = createApp();

export default app;
