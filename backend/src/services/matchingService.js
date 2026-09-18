/**
 * ZYNC Deterministic Matching Engine
 * 
 * Weights:
 * Skill Level:        25%
 * Role Compatibility: 20%
 * Availability:       20%
 * Playstyle:          15%
 * Communication:      10%
 * Competitive Goal:   10%
 * Total:             100%
 */

const ROLE_COMPATIBILITY = {
  'Duelist/Entry': ['Support', 'Initiator', 'Controller/Smokes', 'Flex'],
  'Support': ['Duelist/Entry', 'IGL', 'Sniper', 'Tank', 'Flex'],
  'Controller/Smokes': ['Duelist/Entry', 'Sniper', 'Initiator', 'Flex'],
  'Initiator': ['Duelist/Entry', 'Sniper', 'Controller/Smokes', 'Flex'],
  'IGL': ['Support', 'Flex', 'Tank', 'Sniper', 'Duelist/Entry'],
  'Flex': ['Duelist/Entry', 'Support', 'Controller/Smokes', 'Initiator', 'IGL', 'Sniper', 'Tank', 'Flex'], // Matches with everyone
  'Sniper': ['Controller/Smokes', 'Initiator', 'Support', 'Flex'],
  'Tank': ['Support', 'IGL', 'Flex']
};

/**
 * Helper to calculate skill compatibility (Max 25 pts)
 * Difference of 0 gets 25 pts. Difference of 100 gets 0 pts.
 * Linear scaling: 25 - (diff / 4)
 */
function calculateSkillScore(userSkill, candidateSkill) {
  if (userSkill == null || candidateSkill == null) return { score: 12, reason: 'Skill levels unspecified' };
  const diff = Math.abs(userSkill - candidateSkill);
  // Cap at 0 just in case
  const score = Math.max(0, 25 - (diff / 4));
  let reason = 'Similar skill levels';
  if (diff > 30) reason = 'Noticeable skill gap';
  else if (diff > 15) reason = 'Slight skill difference';
  return { score: Math.round(score), reason };
}

/**
 * Helper to calculate role compatibility (Max 20 pts)
 */
function calculateRoleScore(userRoles, candidateRoles) {
  if (!userRoles?.length || !candidateRoles?.length) return { score: 10, reason: 'Roles unspecified' };
  
  let bestScore = 0;
  let reason = 'Conflicting roles';

  for (const uRole of userRoles) {
    for (const cRole of candidateRoles) {
      if (uRole === cRole) {
        // Shared role isn't always bad, but complementary is better.
        // For MVP, give 15 points for shared role
        if (15 > bestScore) {
          bestScore = 15;
          reason = 'Shared roles';
        }
      }
      
      const compRoles = ROLE_COMPATIBILITY[uRole] || [];
      if (compRoles.includes(cRole)) {
        bestScore = 20;
        reason = 'Complementary roles';
      }
    }
  }

  return { score: bestScore, reason };
}

/**
 * Helper to calculate availability compatibility (Max 20 pts)
 */
function calculateAvailabilityScore(userAvail, candidateAvail) {
  if (!userAvail?.length || !candidateAvail?.length) return { score: 0, reason: 'No availability specified' };
  
  const overlap = userAvail.filter(slot => candidateAvail.includes(slot));
  if (overlap.length === 0) return { score: 0, reason: 'No shared availability' };

  // Score based on percentage of the user's availability that overlaps
  const overlapRatio = overlap.length / Math.max(userAvail.length, candidateAvail.length);
  const score = Math.round(20 * overlapRatio);
  
  let reason = 'Some shared availability';
  if (overlapRatio === 1) reason = 'Perfect availability match';
  else if (overlapRatio >= 0.5) reason = 'Strong availability overlap';

  return { score, reason };
}

/**
 * Helper to calculate playstyle compatibility (Max 15 pts)
 */
function calculatePlaystyleScore(userStyle, candidateStyle) {
  if (!userStyle || !candidateStyle) return { score: 7, reason: 'Playstyle unspecified' };
  if (userStyle === candidateStyle) return { score: 15, reason: 'Matching playstyle' };
  return { score: 7, reason: 'Differing playstyles' };
}

/**
 * Helper to calculate communication compatibility (Max 10 pts)
 */
function calculateCommunicationScore(userComm, candidateComm) {
  if (!userComm || !candidateComm) return { score: 5, reason: 'Comms unspecified' };
  if (userComm === candidateComm) return { score: 10, reason: 'Matching communication preference' };
  return { score: 5, reason: 'Differing communication preference' };
}

/**
 * Helper to calculate competitive goal compatibility (Max 10 pts)
 */
function calculateGoalScore(userGoal, candidateGoal) {
  if (!userGoal || !candidateGoal) return { score: 5, reason: 'Goal unspecified' };
  if (userGoal === candidateGoal) return { score: 10, reason: 'Similar competitive goals' };
  return { score: 0, reason: 'Different competitive goals' };
}

/**
 * Main matching algorithm
 */
export const findMatches = (currentUserProfile, allProfiles) => {
  const matches = [];

  for (const candidate of allProfiles) {
    // 1. Hard Filter: Do not recommend themselves
    if (candidate._id.toString() === currentUserProfile._id.toString()) continue;
    if (!candidate.games || candidate.games.length === 0) continue;

    let bestGameMatch = null;

    // Evaluate compatibility for each shared game
    for (const userGame of currentUserProfile.games) {
      const candidateGame = candidate.games.find(g => g.gameName === userGame.gameName);
      if (!candidateGame) continue; // 2. Hard Filter: Must share game

      const isCurrentlyOnline = candidate.isOnline === true && candidate.onlineUntil && new Date(candidate.onlineUntil) > new Date();

      // 3. Hard Filter: Meaningful availability overlap
      const avail = calculateAvailabilityScore(userGame.availability, candidateGame.availability);
      if (avail.score === 0) {
        if (isCurrentlyOnline) {
          avail.reason = 'Online Now';
        } else {
          continue;
        }
      }

      const skill = calculateSkillScore(userGame.skillLevel, candidateGame.skillLevel);
      // 4. Hard Filter: Reject extreme skill incompatibility (e.g. diff > 60)
      if (Math.abs((userGame.skillLevel || 50) - (candidateGame.skillLevel || 50)) > 60) continue;

      const role = calculateRoleScore(userGame.roles, candidateGame.roles);
      const playstyle = calculatePlaystyleScore(userGame.playstyle, candidateGame.playstyle);
      const comm = calculateCommunicationScore(userGame.communication, candidateGame.communication);
      const goal = calculateGoalScore(userGame.competitiveGoals, candidateGame.competitiveGoals);

      const totalScore = skill.score + role.score + avail.score + playstyle.score + comm.score + goal.score;

      // Collect match reasons (max 3 to avoid UI clutter)
      const reasons = [avail.reason, role.reason, goal.reason, playstyle.reason, skill.reason, comm.reason]
        .filter(r => !r.includes('unspecified') && !r.includes('Different') && !r.includes('gap') && !r.includes('Differing') && !r.includes('Conflicting'))
        .slice(0, 3);

      if (!bestGameMatch || totalScore > bestGameMatch.compatibilityScore) {
        bestGameMatch = {
          userId: candidate._id.toString(),
          displayName: candidate.displayName,
          game: userGame.gameName,
          inGameName: candidateGame.inGameName,
          skillLevel: candidateGame.skillLevel,
          roles: candidateGame.roles,
          availability: candidateGame.availability,
          playstyle: candidateGame.playstyle,
          communication: candidateGame.communication,
          competitiveGoals: candidateGame.competitiveGoals,
          compatibilityScore: totalScore,
          isOnline: candidate.isOnline === true && candidate.onlineUntil && new Date(candidate.onlineUntil) > new Date(),
          breakdown: {
            skill: skill.score,
            role: role.score,
            availability: avail.score,
            playstyle: playstyle.score,
            communication: comm.score,
            goal: goal.score
          },
          matchReasons: reasons.length > 0 ? reasons : ['Compatible baseline profile']
        };
      }
    }

    if (bestGameMatch) {
      matches.push(bestGameMatch);
    }
  }

  // Sort descending by score
  return matches.sort((a, b) => b.compatibilityScore - a.compatibilityScore);
};
