import { describe, it, expect } from 'vitest';
import { findMatches } from '../src/services/matchingService.js';
import mongoose from 'mongoose';

describe('Matching Service', () => {
  const currentUserProfile = {
    _id: new mongoose.Types.ObjectId(),
    displayName: 'UserA',
    reputation: { count: 10, score: 4.0, categories: {} },
    games: [
      {
        gameName: 'Valorant',
        inGameName: 'UserA#NA1',
        skillLevel: 50,
        roles: ['Duelist/Entry'],
        availability: ['mon-eve', 'tue-eve'],
        playstyle: 'Aggressive',
        communication: 'Voice',
        competitiveGoals: 'Rank up'
      }
    ]
  };

  it('calculates fixed weights out of 100 with symmetric evaluation', () => {
    const candidateProfile = {
      _id: new mongoose.Types.ObjectId(),
      displayName: 'UserC',
      reputation: { count: 5, score: 5.0, categories: {} },
      games: [
        {
          gameName: 'Valorant',
          inGameName: 'UserC#NA1',
          skillLevel: 50, // Diff 0 -> 25
          roles: ['Support'], // Complementary -> 18
          availability: ['mon-eve', 'tue-eve'], // Full overlap -> 18
          playstyle: 'Aggressive', // Match -> 14
          communication: 'Voice', // Match -> 10
          competitiveGoals: 'Rank up' // Match -> 5
        }
      ]
    };

    const matches = findMatches(currentUserProfile, [candidateProfile]);
    expect(matches.length).toBe(1);
    const match = matches[0];
    
    expect(match.breakdown).toHaveProperty('skill', 25);
    expect(match.breakdown).toHaveProperty('role', 18);
    expect(match.breakdown).toHaveProperty('availability', 18);
    expect(match.breakdown).toHaveProperty('playstyle', 14);
    expect(match.breakdown).toHaveProperty('communication', 10);
    expect(match.breakdown).toHaveProperty('goal', 5);
    
    // UserA: 4.0/5 => 8, UserC: 5.0/5 => 10. Avg = 9.
    expect(match.breakdown).toHaveProperty('reputation', 9);
    
    // Total score is weighted: 25 + 18 + 18 + 14 + 10 + 5 + 9 = 99
    expect(match.compatibilityScore).toBe(99);
  });

  it('guarantees compatibility(A, B) === compatibility(B, A)', () => {
    const profileA = {
      _id: new mongoose.Types.ObjectId(),
      displayName: 'UserA',
      reputation: { count: 10, score: 3.0, categories: {} }, // 6/10
      isOnline: true,
      onlineUntil: new Date(Date.now() + 1000 * 60 * 60),
      games: [{
        gameName: 'Valorant',
        inGameName: 'A',
        skillLevel: 70, // Diff 20
        roles: ['IGL'], // A is IGL, B is Duelist -> Complementary
        availability: ['mon-eve'], // Overlap: mon-eve out of 3 total max
        playstyle: 'Aggressive',
        communication: 'Voice',
        competitiveGoals: 'Rank up'
      }]
    };

    const profileB = {
      _id: new mongoose.Types.ObjectId(),
      displayName: 'UserB',
      reputation: { count: 1, score: 5.0, categories: {} }, // Neutral 6/10
      isOnline: false,
      games: [{
        gameName: 'Valorant',
        inGameName: 'B',
        skillLevel: 50,
        roles: ['Duelist/Entry'], 
        availability: ['mon-eve', 'tue-eve', 'wed-eve'],
        playstyle: 'Passive',
        communication: 'Ping',
        competitiveGoals: 'Rank up'
      }]
    };

    const matchAtoB = findMatches(profileA, [profileB])[0];
    const matchBtoA = findMatches(profileB, [profileA])[0];

    // Scores must be identical
    expect(matchAtoB.compatibilityScore).toBe(matchBtoA.compatibilityScore);
    
    // Breakdowns must be identical
    expect(matchAtoB.breakdown).toEqual(matchBtoA.breakdown);
  });

  it('rejects candidate if games do not match', () => {
    const candidateProfile = {
      _id: new mongoose.Types.ObjectId(),
      displayName: 'UserD',
      games: [{ gameName: 'CS:GO', inGameName: 'UserD', skillLevel: 50 }]
    };
    const matches = findMatches(currentUserProfile, [candidateProfile]);
    expect(matches.length).toBe(0);
  });

  it('rejects extreme skill incompatibility (> 60)', () => {
    const candidateProfile = {
      _id: new mongoose.Types.ObjectId(),
      displayName: 'UserE',
      games: [{ 
        gameName: 'Valorant', 
        inGameName: 'UserE#NA1', 
        skillLevel: 115, 
      }]
    };
    const matches = findMatches(currentUserProfile, [candidateProfile]);
    expect(matches.length).toBe(0);
  });

  it('rejects offline candidates with no meaningful availability overlap when both are offline', () => {
    const profileA = {
      _id: new mongoose.Types.ObjectId(),
      games: [{ gameName: 'Valorant', skillLevel: 50, availability: ['mon'] }],
      isOnline: false
    };
    const profileB = {
      _id: new mongoose.Types.ObjectId(),
      games: [{ gameName: 'Valorant', skillLevel: 50, availability: ['tue'] }],
      isOnline: false
    };
    const matches = findMatches(profileA, [profileB]);
    expect(matches.length).toBe(0);
  });

  it('allows match with no availability overlap IF EITHER is actively online', () => {
    const profileA = {
      _id: new mongoose.Types.ObjectId(),
      games: [{ gameName: 'Valorant', skillLevel: 50, availability: ['mon'] }],
      isOnline: false
    };
    const profileB = {
      _id: new mongoose.Types.ObjectId(),
      games: [{ gameName: 'Valorant', skillLevel: 50, availability: ['tue'] }],
      isOnline: true,
      onlineUntil: new Date(Date.now() + 1000 * 60 * 60)
    };
    
    const matchesFromA = findMatches(profileA, [profileB]);
    expect(matchesFromA.length).toBe(1);
    expect(matchesFromA[0].breakdown.availability).toBe(0);

    const matchesFromB = findMatches(profileB, [profileA]);
    expect(matchesFromB.length).toBe(1);
    expect(matchesFromB[0].breakdown.availability).toBe(0);
  });
});
