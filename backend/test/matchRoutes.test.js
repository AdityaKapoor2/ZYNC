import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { connectTestDB, closeTestDB, clearTestDB } from './setup.js';
import UserProfile from '../src/models/UserProfile.js';
import * as geminiService from '../src/services/geminiService.js';
import { findMatches } from '../src/services/matchingService.js';
import { matchExplanationRateLimiter } from '../src/middleware/rateLimitMiddleware.js';
import matchRoutes from '../src/routes/matchRoutes.js';

vi.mock('../src/middleware/authMiddleware.js', () => ({
  verifyToken: (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    const token = authHeader.split(' ')[1];
    req.user = { uid: token };
    next();
  }
}));

vi.mock('../src/middleware/activeMiddleware.js', () => ({
  enforceActiveUser: (req, res, next) => next()
}));

vi.mock('../src/services/geminiService.js', () => ({
  explainMatch: vi.fn(),
}));

const app = express();
app.use(express.json());
app.use('/api/matches', matchRoutes);

describe('Match Routes', () => {
  const mockFirebaseUidA = 'user-a-uid';
  const mockFirebaseUidB = 'user-b-uid';
  
  let userAId;
  let userBId;

  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    matchExplanationRateLimiter.reset();
    await clearTestDB();

    const profileA = await UserProfile.create({
      firebaseUid: mockFirebaseUidA,
      email: 'a@example.com',
      displayName: 'UserA',
      games: [{
        gameName: 'Valorant',
        inGameName: 'A_IGN',
        skillLevel: 80,
        roles: ['Duelist'],
        availability: ['Weekends'],
        playstyle: 'Aggressive',
        communication: 'Voice Required',
        competitiveGoals: 'Rank Climbing'
      }]
    });
    userAId = profileA._id;

    const profileB = await UserProfile.create({
      firebaseUid: mockFirebaseUidB,
      email: 'b@example.com',
      displayName: 'UserB',
      games: [{
        gameName: 'Valorant',
        inGameName: 'B_IGN',
        skillLevel: 80,
        roles: ['Controller'],
        availability: ['Weekends'],
        playstyle: 'Aggressive',
        communication: 'Voice Required',
        competitiveGoals: 'Rank Climbing'
      }]
    });
    userBId = profileB._id;
  });

  describe('GET /api/matches/:targetUserId/explanation', () => {
    it('returns an explanation successfully', async () => {
      geminiService.explainMatch.mockResolvedValue('They complement your playstyle.');

      const response = await request(app)
        .get(`/api/matches/${userBId}/explanation`)
        .set('Authorization', `Bearer ${mockFirebaseUidA}`);

      expect(response.status).toBe(200);
      expect(response.body.available).toBe(true);
      expect(response.body.explanation).toBe('They complement your playstyle.');
    });

    it('gracefully handles Gemini failure (fallback)', async () => {
      geminiService.explainMatch.mockRejectedValue(new Error('API Quota Exceeded'));

      const response = await request(app)
        .get(`/api/matches/${userBId}/explanation`)
        .set('Authorization', `Bearer ${mockFirebaseUidA}`);

      expect(response.status).toBe(200);
      expect(response.body.available).toBe(false);
      expect(response.body.explanation).toBeNull();
    });

    it('verifies deterministic symmetry between A->B and B->A', async () => {
      const profileA = await UserProfile.findById(userAId);
      const profileB = await UserProfile.findById(userBId);

      const matchesAtoB = findMatches(profileA, [profileB], 'Valorant');
      const matchesBtoA = findMatches(profileB, [profileA], 'Valorant');

      expect(matchesAtoB.length).toBe(1);
      expect(matchesBtoA.length).toBe(1);

      // Total Score
      expect(matchesAtoB[0].compatibilityScore).toBe(matchesBtoA[0].compatibilityScore);
      
      // Breakdown numbers
      expect(matchesAtoB[0].breakdown).toEqual(matchesBtoA[0].breakdown);
    });

    it('enforces per-user rate limit returning 429 and Retry-After on excess requests', async () => {
      geminiService.explainMatch.mockResolvedValue('They complement your playstyle.');

      // 10 allowed requests
      for (let i = 0; i < 10; i++) {
        const res = await request(app)
          .get(`/api/matches/${userBId}/explanation`)
          .set('Authorization', `Bearer ${mockFirebaseUidA}`);
        expect(res.status).toBe(200);
        expect(res.get('X-RateLimit-Limit')).toBe('10');
      }

      // 11th request exceeds limit
      const excessRes = await request(app)
        .get(`/api/matches/${userBId}/explanation`)
        .set('Authorization', `Bearer ${mockFirebaseUidA}`);

      expect(excessRes.status).toBe(429);
      expect(excessRes.body.message).toContain('Too many match explanation requests');
      expect(excessRes.body).toHaveProperty('retryAfter');
      expect(excessRes.get('Retry-After')).toBeDefined();

      // Different user (User B) should NOT be blocked
      const userBRes = await request(app)
        .get(`/api/matches/${userAId}/explanation`)
        .set('Authorization', `Bearer ${mockFirebaseUidB}`);

      expect(userBRes.status).toBe(200);
    });
  });

  describe('GET /api/matches (Eligibility & Discovery)', () => {
    it('returns valid active candidates with matching games and scores', async () => {
      const response = await request(app)
        .get('/api/matches?game=Valorant')
        .set('Authorization', `Bearer ${mockFirebaseUidA}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('matches');
      expect(response.body.matches.length).toBe(1);
      expect(response.body.matches[0].userId).toBe(userBId.toString());
      expect(response.body.matches[0].game).toBe('Valorant');
      expect(response.body.matches[0].compatibilityScore).toBeGreaterThan(0);
      expect(response.body.matches[0].breakdown).toBeDefined();
    });

    it('excludes candidate if candidate is suspended', async () => {
      await UserProfile.findByIdAndUpdate(userBId, { accountStatus: 'suspended' });

      const response = await request(app)
        .get('/api/matches?game=Valorant')
        .set('Authorization', `Bearer ${mockFirebaseUidA}`);

      expect(response.status).toBe(200);
      expect(response.body.matches.length).toBe(0);
    });

    it('excludes candidate if candidate is a super_admin', async () => {
      await UserProfile.findByIdAndUpdate(userBId, { role: 'super_admin' });

      const response = await request(app)
        .get('/api/matches?game=Valorant')
        .set('Authorization', `Bearer ${mockFirebaseUidA}`);

      expect(response.status).toBe(200);
      expect(response.body.matches.length).toBe(0);
    });

    it('excludes candidate if candidate is already in user connections', async () => {
      await UserProfile.findByIdAndUpdate(userAId, {
        $addToSet: { connections: userBId }
      });

      const response = await request(app)
        .get('/api/matches?game=Valorant')
        .set('Authorization', `Bearer ${mockFirebaseUidA}`);

      expect(response.status).toBe(200);
      expect(response.body.matches.length).toBe(0);
    });

    it('returns multiple candidates properly filtering only the ineligible ones', async () => {
      const profileC = await UserProfile.create({
        firebaseUid: 'user-c-uid',
        email: 'c@example.com',
        displayName: 'UserC',
        accountStatus: 'active',
        role: 'user',
        games: [{
          gameName: 'Valorant',
          inGameName: 'C_IGN',
          skillLevel: 75,
          roles: ['Support'],
          availability: ['Weekends'],
          playstyle: 'Aggressive',
          communication: 'Voice Required',
          competitiveGoals: 'Rank Climbing'
        }]
      });

      // Make user B suspended
      await UserProfile.findByIdAndUpdate(userBId, { accountStatus: 'suspended' });

      const response = await request(app)
        .get('/api/matches?game=Valorant')
        .set('Authorization', `Bearer ${mockFirebaseUidA}`);

      expect(response.status).toBe(200);
      expect(response.body.matches.length).toBe(1);
      expect(response.body.matches[0].userId).toBe(profileC._id.toString());
    });
  });
});
