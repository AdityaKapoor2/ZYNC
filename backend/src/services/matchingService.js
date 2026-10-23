/**
 * ZYNC Deterministic Matching Engine
 * 
 * Weights:
 * Skill Level:        25%
 * Role Compatibility: 18%
 * Availability:       18%
 * Playstyle:          14%
 * Communication:      10%
 * Reputation:         10%
 * Competitive Goal:   5%
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

function calculateRoleScore(userRoles, candidateRoles) {
  if (!userRoles?.length || !candidateRoles?.length) return { score: 9, reason: 'Roles unspecified' };

  let bestScore = 0;
  let reason = 'Conflicting roles';

  const maxScore = 18;
  const sharedScore = 13;

  for (const uRole of userRoles) {
    for (const cRole of candidateRoles) {
      if (uRole === cRole) {
        if (sharedScore > bestScore) {
          bestScore = sharedScore;
          reason = 'Shared roles';
        }
      }

      // Check for bidirectional compatibility edge
      const uComp = ROLE_COMPATIBILITY[uRole] || [];
      const cComp = ROLE_COMPATIBILITY[cRole] || [];
      if (uComp.includes(cRole) || cComp.includes(uRole)) {
        bestScore = maxScore;
        reason = 'Complementary roles';
      }
    }
  }

  return { score: bestScore, reason };
}

function calculateAvailabilityScore(userAvail, candidateAvail) {
  if (!userAvail?.length || !candidateAvail?.length) return { score: 0, reason: 'No availability specified' };

  const overlap = userAvail.filter(slot => candidateAvail.includes(slot));
  if (overlap.length === 0) return { score: 0, reason: 'No shared availability' };

  const maxScore = 18;

  // Score based on percentage of the max availability length
  const overlapRatio = overlap.length / Math.max(userAvail.length, candidateAvail.length);
  const score = Math.round(maxScore * overlapRatio);

  let reason = 'Some shared availability';
  if (overlapRatio === 1) reason = 'Perfect availability match';
  else if (overlapRatio >= 0.5) reason = 'Strong availability overlap';

  return { score, reason };
}

function calculatePlaystyleScore(userStyle, candidateStyle) {
  const maxScore = 14;
  if (!userStyle || !candidateStyle) return { score: Math.round(maxScore / 2), reason: 'Playstyle unspecified' };
  if (userStyle === candidateStyle) return { score: maxScore, reason: 'Matching playstyle' };
  return { score: Math.round(maxScore / 2), reason: 'Differing playstyles' };
}

/**
 * Helper to calculate communication compatibility (Max 10 pts)
 */
function calculateCommunicationScore(userComm, candidateComm) {
  if (!userComm || !candidateComm) return { score: 5, reason: 'Comms unspecified' };
  if (userComm === candidateComm) return { score: 10, reason: 'Matching communication preference' };
  return { score: 5, reason: 'Differing communication preference' };
}

function calculateGoalScore(userGoal, candidateGoal) {
  const maxScore = 5;
  if (!userGoal || !candidateGoal) return { score: Math.round(maxScore / 2), reason: 'Goal unspecified' };
  if (userGoal === candidateGoal) return { score: maxScore, reason: 'Similar competitive goals' };
  return { score: 0, reason: 'Different competitive goals' };
}

function calculateReputationScore(userRep, candidateRep) {
  const getRepScore = (rep) => {
    if (!rep || !rep.count || rep.count < 5) return 6; // Neutral score out of 10
    return (rep.score / 5) * 10;
  };

  const uScore = getRepScore(userRep);
  const cScore = getRepScore(candidateRep);
  
  // Pairwise symmetric reputation score
  const score = Math.round((uScore + cScore) / 2);

  let reason = 'Good community reputation';
  if (score < 6) reason = 'Lower community reputation';
  else if (score >= 9) reason = 'Excellent community reputation';
  else if (uScore === 6 && cScore === 6) reason = 'Neutral community reputation';

  return { score, reason };
}

function isUserOnline(profile) {
  if (!profile) return false;
  if (profile.visibilityPreference === 'invisible') return false;
  return profile.isOnline === true && profile.onlineUntil && new Date(profile.onlineUntil) > new Date();
}

/**
 * Main matching algorithm
 */
export const findMatches = (currentUserProfile, allProfiles, selectedGame) => {
  const matches = [];

  for (const candidate of allProfiles) {
    // 1. Hard Filter: Do not recommend themselves
    if (candidate._id.toString() === currentUserProfile._id.toString()) continue;
    if (!candidate.games || candidate.games.length === 0) continue;

    let bestGameMatch = null;

    // Evaluate compatibility for each shared game
    let gamesToEvaluate = currentUserProfile.games;
    if (selectedGame) {
      gamesToEvaluate = currentUserProfile.games.filter(g => g.gameName === selectedGame);
    }

    for (const userGame of gamesToEvaluate) {
      const candidateGame = candidate.games.find(g => g.gameName === userGame.gameName);
      if (!candidateGame) continue; // 2. Hard Filter: Must share game

      const userOnline = isUserOnline(currentUserProfile);
      const candidateOnline = isUserOnline(candidate);
      const eitherOnline = userOnline || candidateOnline;

      // 3. Hard Filter: Meaningful availability overlap
      const avail = calculateAvailabilityScore(userGame.availability, candidateGame.availability);
      if (avail.score === 0) {
        if (eitherOnline) {
          avail.reason = 'Online Now';
        } else {
          continue; // Neither is online and no schedule overlap
        }
      }

      const skill = calculateSkillScore(userGame.skillLevel, candidateGame.skillLevel);
      // 4. Hard Filter: Reject extreme skill incompatibility (e.g. diff > 60)
      if (Math.abs((userGame.skillLevel || 50) - (candidateGame.skillLevel || 50)) > 60) continue;

      const role = calculateRoleScore(userGame.roles, candidateGame.roles);
      const playstyle = calculatePlaystyleScore(userGame.playstyle, candidateGame.playstyle);
      const comm = calculateCommunicationScore(userGame.communication, candidateGame.communication);
      const goal = calculateGoalScore(userGame.competitiveGoals, candidateGame.competitiveGoals);
      const rep = calculateReputationScore(currentUserProfile.reputation, candidate.reputation);

      const totalScore = skill.score + role.score + avail.score + playstyle.score + comm.score + goal.score + rep.score;

      // Collect match reasons (max 3 to avoid UI clutter)
      const reasons = [avail.reason, role.reason, goal.reason, playstyle.reason, skill.reason, comm.reason, rep.reason]
        .filter(r => r && !r.includes('unspecified') && !r.includes('Different') && !r.includes('gap') && !r.includes('Differing') && !r.includes('Conflicting') && !r.includes('insufficient') && !r.includes('Neutral'))
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
          isOnline: candidateOnline, // We only care if the CANDIDATE is online for UI rendering
          reputation: candidate.reputation,
          breakdown: {
            skill: skill.score,
            role: role.score,
            availability: avail.score,
            playstyle: playstyle.score,
            communication: comm.score,
            goal: goal.score,
            reputation: rep.score
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
