import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { connectTestDB, closeTestDB, clearTestDB } from './setup.js';
import UserProfile from '../src/models/UserProfile.js';
import profileRoutes from '../src/routes/profileRoutes.js';

// Mock auth middleware to populate req.user from Bearer token
vi.mock('../src/middleware/authMiddleware.js', () => ({
  verifyToken: (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Unauthorized: No token provided' });
    }
    const token = authHeader.split(' ')[1];
    req.user = {
      uid: token,
      email: `${token}@test.com`
    };
    next();
  }
}));

const app = express();
app.use(express.json());
app.use('/api/profiles', profileRoutes);

describe('SEC-07: Display Name Validation', () => {
  let activeUser;

  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();

    activeUser = await UserProfile.create({
      firebaseUid: 'active_user_uid',
      email: 'active@test.com',
      displayName: 'OriginalPlayer',
      accountStatus: 'active',
      games: [{
        gameName: 'Valorant',
        inGameName: 'OriginalIGN#1234',
        skillLevel: 50
      }]
    });
  });

  describe('1. Valid Display Names', () => {
    it('accepts a valid standard display name and updates database', async () => {
      const res = await request(app)
        .put('/api/profiles/me')
        .set('Authorization', 'Bearer active_user_uid')
        .send({ displayName: 'ApexChampion99' });

      expect(res.status).toBe(200);
      expect(res.body.displayName).toBe('ApexChampion99');

      const updated = await UserProfile.findById(activeUser._id);
      expect(updated.displayName).toBe('ApexChampion99');
    });

    it('accepts a display name of exactly 50 characters', async () => {
      const exact50 = 'A'.repeat(50);
      const res = await request(app)
        .put('/api/profiles/me')
        .set('Authorization', 'Bearer active_user_uid')
        .send({ displayName: exact50 });

      expect(res.status).toBe(200);
      expect(res.body.displayName).toBe(exact50);

      const updated = await UserProfile.findById(activeUser._id);
      expect(updated.displayName).toBe(exact50);
    });
  });

  describe('2. Whitespace Trimming and Empty/Blank Values', () => {
    it('trims leading and trailing whitespace from valid display names', async () => {
      const res = await request(app)
        .put('/api/profiles/me')
        .set('Authorization', 'Bearer active_user_uid')
        .send({ displayName: '   PaddedPlayerName   ' });

      expect(res.status).toBe(200);
      expect(res.body.displayName).toBe('PaddedPlayerName');

      const updated = await UserProfile.findById(activeUser._id);
      expect(updated.displayName).toBe('PaddedPlayerName');
    });

    it('rejects an empty string with 400 Bad Request', async () => {
      const res = await request(app)
        .put('/api/profiles/me')
        .set('Authorization', 'Bearer active_user_uid')
        .send({ displayName: '' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/display name cannot be empty/i);

      // Verify DB was not changed
      const unchanged = await UserProfile.findById(activeUser._id);
      expect(unchanged.displayName).toBe('OriginalPlayer');
    });

    it('rejects a whitespace-only string with 400 Bad Request', async () => {
      const res = await request(app)
        .put('/api/profiles/me')
        .set('Authorization', 'Bearer active_user_uid')
        .send({ displayName: '     ' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/display name cannot be empty/i);

      const unchanged = await UserProfile.findById(activeUser._id);
      expect(unchanged.displayName).toBe('OriginalPlayer');
    });
  });

  describe('3. Non-String Input Types', () => {
    it('rejects numeric input with 400 Bad Request', async () => {
      const res = await request(app)
        .put('/api/profiles/me')
        .set('Authorization', 'Bearer active_user_uid')
        .send({ displayName: 12345 });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/display name must be a string/i);
    });

    it('rejects boolean input with 400 Bad Request', async () => {
      const res = await request(app)
        .put('/api/profiles/me')
        .set('Authorization', 'Bearer active_user_uid')
        .send({ displayName: true });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/display name must be a string/i);
    });

    it('rejects object input with 400 Bad Request', async () => {
      const res = await request(app)
        .put('/api/profiles/me')
        .set('Authorization', 'Bearer active_user_uid')
        .send({ displayName: { name: 'NestedName' } });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/display name must be a string/i);
    });

    it('rejects array input with 400 Bad Request', async () => {
      const res = await request(app)
        .put('/api/profiles/me')
        .set('Authorization', 'Bearer active_user_uid')
        .send({ displayName: ['Player1', 'Player2'] });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/display name must be a string/i);
    });

    it('rejects null input with 400 Bad Request', async () => {
      const res = await request(app)
        .put('/api/profiles/me')
        .set('Authorization', 'Bearer active_user_uid')
        .send({ displayName: null });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/display name must be a string/i);
    });
  });

  describe('4. Length Constraints (> 50 characters)', () => {
    it('rejects display name exceeding 50 characters (51 chars) with 400 Bad Request', async () => {
      const over50 = 'A'.repeat(51);
      const res = await request(app)
        .put('/api/profiles/me')
        .set('Authorization', 'Bearer active_user_uid')
        .send({ displayName: over50 });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/cannot exceed 50 characters/i);

      const unchanged = await UserProfile.findById(activeUser._id);
      expect(unchanged.displayName).toBe('OriginalPlayer');
    });

    it('rejects 51 characters even if padded with whitespace that trims down to 51', async () => {
      const paddedOver50 = '  ' + 'B'.repeat(51) + '  ';
      const res = await request(app)
        .put('/api/profiles/me')
        .set('Authorization', 'Bearer active_user_uid')
        .send({ displayName: paddedOver50 });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/cannot exceed 50 characters/i);
    });

    it('accepts string whose raw length is > 50 but trims to <= 50 characters', async () => {
      // 5 spaces + 50 characters + 5 spaces = 60 chars raw, trims to 50
      const padded50 = '     ' + 'C'.repeat(50) + '     ';
      const res = await request(app)
        .put('/api/profiles/me')
        .set('Authorization', 'Bearer active_user_uid')
        .send({ displayName: padded50 });

      expect(res.status).toBe(200);
      expect(res.body.displayName).toBe('C'.repeat(50));
    });
  });

  describe('5. Profile Updates Without Display Name (Preservation)', () => {
    it('preserves existing display name when only games are updated', async () => {
      const res = await request(app)
        .put('/api/profiles/me')
        .set('Authorization', 'Bearer active_user_uid')
        .send({
          games: [{
            gameName: 'Valorant',
            inGameName: 'UpdatedIGN#5555'
          }]
        });

      expect(res.status).toBe(200);
      expect(res.body.displayName).toBe('OriginalPlayer');
      expect(res.body.games[0].inGameName).toBe('UpdatedIGN#5555');

      const updated = await UserProfile.findById(activeUser._id);
      expect(updated.displayName).toBe('OriginalPlayer');
    });
  });

  describe('6. Model Schema Consistency', () => {
    it('model schema enforces trim and maxlength at Mongoose document validation layer', async () => {
      const invalidDoc = new UserProfile({
        firebaseUid: 'direct_save_uid',
        email: 'direct@test.com',
        displayName: 'X'.repeat(51)
      });

      let validationError;
      try {
        await invalidDoc.validate();
      } catch (err) {
        validationError = err;
      }

      expect(validationError).toBeDefined();
      expect(validationError.errors.displayName).toBeDefined();
      expect(validationError.errors.displayName.kind).toBe('maxlength');
    });
  });
});
