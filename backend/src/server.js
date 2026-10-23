import 'dotenv/config';
import http from 'http';
import connectDB from './config/db.js';
import app from './app.js';
import { initSocket } from './config/socket.js';
import { getAllowedOrigins } from './config/cors.js';

// Connect to Database
if (process.env.MONGODB_URI) {
  await connectDB();
} else {
  console.error('MONGODB_URI not found in environment variables. Database not connected.');
  process.exit(1);
}

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);

// Initialize Socket.IO with Express trust proxy setting and CORS allowed origins
initSocket(server, {
  trustProxy: app.get('trust proxy'),
  allowedOrigins: getAllowedOrigins()
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

