import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import dotenv from 'dotenv';

dotenv.config();

// In production, this should be parsed from the environment variable
// Since we don't have a real service account key yet, we mock or handle it gracefully
let firebaseApp;

try {
  if (process.env.FIREBASE_PROJECT_ID) {
    const serviceAccount = {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Replace literal \n with actual newlines
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    };

    firebaseApp = initializeApp({
      credential: cert(serviceAccount)
    });
    console.log('Firebase Admin initialized');
  } else {
    console.warn('Firebase Admin not initialized: Missing FIREBASE_PROJECT_ID in env');
  }
} catch (error) {
  console.error('Firebase Admin initialization error', error);
}

const admin = {
  auth: () => getAuth(firebaseApp)
};

export default admin;
