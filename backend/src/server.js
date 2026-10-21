import dotenv from 'dotenv';
import connectDB from './config/db.js';
import app from './app.js';

dotenv.config();

// Connect to Database
if (process.env.MONGODB_URI) {
  await connectDB();
} else {
  console.error('MONGODB_URI not found in environment variables. Database not connected.');
  process.exit(1);
}

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
