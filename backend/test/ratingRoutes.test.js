import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import { connectTestDB, closeTestDB, clearTestDB } from './setup.js';

// Mock auth middleware BEFORE importing the route
vi.mock('../src/middleware/authMiddleware.js', () => ({
  verifyToken: (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ message: 'Unauthorized: No token provided' });
    }
    const token = authHeader.split(' ')[1];
    if (token === 'invalid_token') {
      return res.status(401).json({ message: 'Unauthorized: Invalid token' });
    }
    // token acts as the firebaseUid in tests
    req.user = { uid: token };
    next();
  }
}));

import ratingRoutes from '../src/routes/ratingRoutes.js';
import UserProfile from '../src/models/UserProfile.js';
import Connection from '../src/models/Connection.js';
import Rating from '../src/models/Rating.js';

const app = express();
app.use(express.json());
app.use('/api/ratings', ratingRoutes);

describe('Rating & Reputation System', () => {
  let userA, userB, userC, userD;

  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    
    // Create users
    userA = await UserProfile.create({ firebaseUid: 'uidA', displayName: 'User A', email: 'a@a.com', games: [] });
    userB = await UserProfile.create({ firebaseUid: 'uidB', displayName: 'User B', email: 'b@b.com', games: [] });
    userC = await UserProfile.create({ firebaseUid: 'uidC', displayName: 'User C', email: 'c@c.com', games: [] });
    userD = await UserProfile.create({ firebaseUid: 'uidD', displayName: 'User D', email: 'd@d.com', games: [] });
    
    // Create connections
    // A and B are accepted
    await Connection.create({ requester: userA._id, recipient: userB._id, status: 'accepted' });
    // A and C are pending
    await Connection.create({ requester: userA._id, recipient: userC._id, status: 'pending' });
    // A and D are rejected
    await Connection.create({ requester: userA._id, recipient: userD._id, status: 'rejected' });
  });

  // AUTHORIZATION
  describe('Authorization', () => {
    it('rejects requests with no token', async () => {
      const res = await request(app).post('/api/ratings').send({ ratedUserId: userB._id, overall: 5 });
      expect(res.status).toBe(401);
    });

    it('rejects requests with invalid token', async () => {
      const res = await request(app).post('/api/ratings').set('Authorization', 'Bearer invalid_token').send({ ratedUserId: userB._id, overall: 5 });
      expect(res.status).toBe(401);
    });
  });

  // RATING VALIDATION & ERRORS
  describe('Validation & Restrictions', () => {
    it('rejects self-rating', async () => {
      const res = await request(app).post('/api/ratings')
        .set('Authorization', 'Bearer uidA')
        .send({ ratedUserId: userA._id.toString(), overall: 5 });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('You cannot rate yourself.');
    });

    it('rejects rating a non-existent user', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app).post('/api/ratings')
        .set('Authorization', 'Bearer uidA')
        .send({ ratedUserId: fakeId.toString(), overall: 5 });
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Rated user profile not found.');
    });

    it('rejects rating if not connected', async () => {
      // User B and User C are not connected
      const res = await request(app).post('/api/ratings')
        .set('Authorization', 'Bearer uidB')
        .send({ ratedUserId: userC._id.toString(), overall: 5 });
      expect(res.status).toBe(403);
      expect(res.body.message).toBe('You can only rate accepted connections.');
    });

    it('rejects rating a pending connection', async () => {
      // A and C are pending
      const res = await request(app).post('/api/ratings')
        .set('Authorization', 'Bearer uidA')
        .send({ ratedUserId: userC._id.toString(), overall: 5 });
      expect(res.status).toBe(403);
    });

    it('rejects rating a rejected connection', async () => {
      // A and D are rejected
      const res = await request(app).post('/api/ratings')
        .set('Authorization', 'Bearer uidA')
        .send({ ratedUserId: userD._id.toString(), overall: 5 });
      expect(res.status).toBe(403);
    });

    it('rejects missing overall rating', async () => {
      const res = await request(app).post('/api/ratings')
        .set('Authorization', 'Bearer uidA')
        .send({ ratedUserId: userB._id.toString() });
      expect(res.status).toBe(400);
    });

    it('rejects overall rating < 1 or > 5', async () => {
      const res1 = await request(app).post('/api/ratings')
        .set('Authorization', 'Bearer uidA')
        .send({ ratedUserId: userB._id.toString(), overall: 0 });
      expect(res1.status).toBe(400);

      const res2 = await request(app).post('/api/ratings')
        .set('Authorization', 'Bearer uidA')
        .send({ ratedUserId: userB._id.toString(), overall: 6 });
      expect(res2.status).toBe(400);
    });

    it('rejects invalid category rating > 5', async () => {
      const res = await request(app).post('/api/ratings')
        .set('Authorization', 'Bearer uidA')
        .send({ ratedUserId: userB._id.toString(), overall: 5, communication: 6 });
      expect(res.status).toBe(500); // Mongoose validation error throws 500 in current controller
    });
  });

  // RATING SUCCESS & 24-HOUR COOLDOWN
  describe('Success & Cooldown', () => {
    it('successfully creates a valid rating and updates reputation', async () => {
      const res = await request(app).post('/api/ratings')
        .set('Authorization', 'Bearer uidA')
        .send({ 
          ratedUserId: userB._id.toString(), 
          overall: 4, 
          communication: 5, 
          teamwork: 3 
        });
      
      expect(res.status).toBe(201);
      expect(res.body.message).toBe('Rating submitted successfully.');
      
      // Verify DB
      const rating = await Rating.findOne({ rater: userA._id, ratedUser: userB._id });
      expect(rating).toBeTruthy();
      expect(rating.overall).toBe(4);
      expect(rating.communication).toBe(5);

      // Verify User Profile Reputation Update
      const updatedB = await UserProfile.findById(userB._id);
      expect(updatedB.reputation.score).toBe(4);
      expect(updatedB.reputation.count).toBe(1);
      expect(updatedB.reputation.categories.communication).toBe(5);
      expect(updatedB.reputation.categories.teamwork).toBe(3);
    });

    it('enforces a 24-hour directional cooldown', async () => {
      // 1. A rates B -> SUCCESS
      await request(app).post('/api/ratings')
        .set('Authorization', 'Bearer uidA')
        .send({ ratedUserId: userB._id.toString(), overall: 5 });

      // 2. A rates B immediately again -> REJECTED
      const res2 = await request(app).post('/api/ratings')
        .set('Authorization', 'Bearer uidA')
        .send({ ratedUserId: userB._id.toString(), overall: 4 });
      expect(res2.status).toBe(429);
      expect(res2.body.message).toBe('You can only rate this player once every 24 hours.');

      // 3. B rates A -> SUCCESS
      const res3 = await request(app).post('/api/ratings')
        .set('Authorization', 'Bearer uidB')
        .send({ ratedUserId: userA._id.toString(), overall: 3 });
      expect(res3.status).toBe(201);
    });
  });

  // MULTIPLE RATINGS REPUTATION MATH
  describe('Reputation Aggregation Math', () => {
    it('accurately calculates average and count', async () => {
      // Bypass API limits to insert direct DB ratings to test aggregation logic
      await Rating.create([
        { rater: new mongoose.Types.ObjectId(), ratedUser: userB._id, overall: 5 },
        { rater: new mongoose.Types.ObjectId(), ratedUser: userB._id, overall: 4 },
        { rater: new mongoose.Types.ObjectId(), ratedUser: userB._id, overall: 5 },
        { rater: new mongoose.Types.ObjectId(), ratedUser: userB._id, overall: 4 }
      ]);
      
      // Trigger update via API 
      const res = await request(app).post('/api/ratings')
        .set('Authorization', 'Bearer uidA')
        .send({ ratedUserId: userB._id.toString(), overall: 5 });
      
      expect(res.status).toBe(201);
      
      const updatedB = await UserProfile.findById(userB._id);
      expect(updatedB.reputation.count).toBe(5);
      // (5 + 4 + 5 + 4 + 5) / 5 = 4.6
      expect(updatedB.reputation.score).toBe(4.6);
    });
  });
});
