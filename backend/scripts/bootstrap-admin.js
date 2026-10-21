import dotenv from 'dotenv';
import mongoose from 'mongoose';
import admin from '../src/config/firebase-admin.js';
import connectDB from '../src/config/db.js';
import UserProfile from '../src/models/UserProfile.js';

dotenv.config();

const bootstrap = async () => {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;

  if (!email) {
    console.error('Error: BOOTSTRAP_ADMIN_EMAIL environment variable is missing.');
    console.error('Please add BOOTSTRAP_ADMIN_EMAIL=your@email.com to your .env file.');
    process.exit(1);
  }

  let exitCode = 0;

  try {
    console.log(`Looking up Firebase user for: ${email}`);
    let userRecord;
    try {
      userRecord = await admin.auth().getUserByEmail(email);
    } catch (err) {
      console.error(`\nError: Could not find Firebase user with email ${email}.`);
      console.error(`Firebase Admin Error: ${err.message}`);
      exitCode = 1;
      return;
    }

    const firebaseUid = userRecord.uid;
    console.log('Firebase user found.');

    if (!process.env.MONGODB_URI) {
      console.error('\nError: MONGODB_URI not found in environment variables.');
      exitCode = 1;
      return;
    }

    // connectDB will process.exit(1) on failure, which is acceptable for this script
    await connectDB();

    const userProfile = await UserProfile.findOne({ firebaseUid });

    if (!userProfile) {
      console.error('\nError: UserProfile not found in MongoDB.');
      console.error('The Firebase account exists, but the user has not completed ZYNC profile creation.');
      console.error('Please log into ZYNC with this account and complete onboarding first.');
      exitCode = 1;
      return;
    }

    if (userProfile.role === 'super_admin') {
      console.log('\nSuccess: User is already a super_admin. No changes made.');
      return;
    }

    userProfile.role = 'super_admin';
    await userProfile.save();

    console.log('\nSuccess: User has been promoted to super_admin.');
  } catch (error) {
    console.error('\nError during bootstrap process:');
    console.error(error.message);
    exitCode = 1;
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      console.log('MongoDB connection closed.');
    }
    process.exit(exitCode);
  }
};

bootstrap();
