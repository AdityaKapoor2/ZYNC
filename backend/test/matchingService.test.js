import { describe, it, expect } from 'vitest';
import { findMatches } from '../src/services/matchingService.js';
import mongoose from 'mongoose';

describe('Matching Service', () => {
  const currentUserProfile = {
    _id: new mongoose.Types.ObjectId(),
    displayName: 'UserA',
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

  it('calculates compatibility for candidates with < 5 ratings (Mode 1)', () => {
    const candidateProfile = {
      _id: new mongoose.Types.ObjectId(),
      displayName: 'UserB',
      reputation: { count: 3, score: 5.0, categories: {} },
      games: [
        {
          gameName: 'Valorant',
          inGameName: 'UserB#NA1',
          skillLevel: 50, // Diff 0 -> 25
          roles: ['Support'], // Complementary -> 20
          availability: ['mon-eve', 'tue-eve'], // Full overlap -> 20
          playstyle: 'Aggressive', // Match -> 15
          communication: 'Voice', // Match -> 10
          competitiveGoals: 'Rank up' // Match -> 10
        }
      ]
    };

    const matches = findMatches(currentUserProfile, [candidateProfile]);
    expect(matches.length).toBe(1);
    const match = matches[0];
    
    // Total should be exactly 100 for a perfect match, ignoring reputation
    expect(match.compatibilityScore).toBe(100);
    
    // Reputation should NOT be in the breakdown
    expect(match.breakdown).toHaveProperty('skill', 25);
    expect(match.breakdown).toHaveProperty('role', 20);
    expect(match.breakdown).toHaveProperty('availability', 20);
    expect(match.breakdown).toHaveProperty('playstyle', 15);
    expect(match.breakdown).toHaveProperty('communication', 10);
    expect(match.breakdown).toHaveProperty('goal', 10);
    expect(match.breakdown).not.toHaveProperty('reputation');
  });

  it('calculates compatibility for candidates with 5+ ratings (Mode 2)', () => {
    const candidateProfile = {
      _id: new mongoose.Types.ObjectId(),
      displayName: 'UserC',
      reputation: { count: 5, score: 5.0, categories: {} },
      games: [
        {
          gameName: 'Valorant',
          inGameName: 'UserC#NA1',
          skillLevel: 50, // Diff 0 -> 25
          roles: ['Support'], // Complementary -> 20 (base), Mode2 -> 18
          availability: ['mon-eve', 'tue-eve'], // Full overlap -> 20 (base), Mode2 -> 18
          playstyle: 'Aggressive', // Match -> 15 (base), Mode2 -> 14
          communication: 'Voice', // Match -> 10
          competitiveGoals: 'Rank up' // Match -> 10 (base), Mode2 -> 5
        }
      ]
    };

    const matches = findMatches(currentUserProfile, [candidateProfile]);
    expect(matches.length).toBe(1);
    const match = matches[0];
    
    // Mode 2 Breakdown Values should be the RAW BASE VALUES for the /10 normalization
    expect(match.breakdown).toHaveProperty('skill', 25);
    expect(match.breakdown).toHaveProperty('role', 18);
    expect(match.breakdown).toHaveProperty('availability', 18);
    expect(match.breakdown).toHaveProperty('playstyle', 14);
    expect(match.breakdown).toHaveProperty('communication', 10);
    expect(match.breakdown).toHaveProperty('goal', 5);
    expect(match.breakdown).toHaveProperty('reputation', 10);
    
    // Total score is weighted: 25 + 18 + 18 + 14 + 10 + 5 + 10 = 100
    expect(match.compatibilityScore).toBe(100);
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
        skillLevel: 100, // Diff 50 - >60 ? No, wait. 100-50 = 50. Let's make it 120. Wait, skillLevel max is 100? Let's use 111.
      }]
    };
    // Re-create candidate with skill 115
    candidateProfile.games[0].skillLevel = 115;
    const matches = findMatches(currentUserProfile, [candidateProfile]);
    expect(matches.length).toBe(0);
  });

  it('rejects offline candidate with no meaningful availability overlap', () => {
    const candidateProfile = {
      _id: new mongoose.Types.ObjectId(),
      displayName: 'UserF',
      games: [{ 
        gameName: 'Valorant', 
        inGameName: 'UserF#NA1', 
        skillLevel: 50,
        availability: ['wed-eve'] // No overlap
      }],
      isOnline: false
    };
    const matches = findMatches(currentUserProfile, [candidateProfile]);
    expect(matches.length).toBe(0);
  });

  it('allows candidate with no availability overlap IF they are actively online', () => {
    const candidateProfile = {
      _id: new mongoose.Types.ObjectId(),
      displayName: 'UserG',
      games: [{ 
        gameName: 'Valorant', 
        inGameName: 'UserG#NA1', 
        skillLevel: 50,
        availability: ['wed-eve'] // No overlap
      }],
      isOnline: true,
      onlineUntil: new Date(Date.now() + 1000 * 60 * 60) // Online for another hour
    };
    const matches = findMatches(currentUserProfile, [candidateProfile]);
    expect(matches.length).toBe(1);
    expect(matches[0].breakdown.availability).toBe(0); // Score is still 0
  });

  it('rejects candidate if onlineUntil is expired despite isOnline true', () => {
    const candidateProfile = {
      _id: new mongoose.Types.ObjectId(),
      displayName: 'UserH',
      games: [{ 
        gameName: 'Valorant', 
        inGameName: 'UserH#NA1', 
        skillLevel: 50,
        availability: ['wed-eve'] // No overlap
      }],
      isOnline: true,
      onlineUntil: new Date(Date.now() - 1000 * 60 * 60) // Expired an hour ago
    };
    const matches = findMatches(currentUserProfile, [candidateProfile]);
    expect(matches.length).toBe(0);
  });
});
