// frontend/bracket/createBracket.ts

import { BracketSize, BracketState, Id, MatchNode, Team } from "./types";

function makeTeamId(seed: number): Id {
  return `team:${seed}`;
}

function makeMatchId(round: number, index: number): Id {
  return `match:r${round}:m${index}`;
}

function roundsForSize(size: BracketSize): number {
  // size is 4/8/16/32/64 so log2 is an integer
  return Math.log2(size);
}

/**
 * Creates a single-elimination tournament bracket.
 * - Round 1 has size/2 matches
 * - Each next round halves matches until finals (1 match)
 * - Round 1 teams are seeded in order of teamNames
 */
export function createBracket(
  size: BracketSize,
  teamNames: string[],
): BracketState {
  const nTeams = size;
  const nRounds = roundsForSize(size);

  // --- Teams registry ---
  const teams: Team[] = Array.from({ length: nTeams }, (_, i) => {
    const name = teamNames[i] ?? "";
    return { id: makeTeamId(i), name };
  });

  const teamsById: Record<Id, Team> = {};
  for (const t of teams) teamsById[t.id] = t;

  // --- Matches registry + round structure ---
  const matchesById: Record<Id, MatchNode> = {};
  const roundMatchIds: Id[][] = [];

  for (let round = 1; round <= nRounds; round++) {
    const matchesThisRound = nTeams / Math.pow(2, round); // e.g. size=8: r1=4, r2=2, r3=1
    const ids: Id[] = [];

    for (let index = 0; index < matchesThisRound; index++) {
      const id = makeMatchId(round, index);

      const node: MatchNode = {
        id,
        round,
        index,
        winnerId: undefined,
        feederMatchIds: [],
      };

      // Round 1: seed teams into slots A/B
      if (round === 1) {
        const teamA = teams[2 * index];
        const teamB = teams[2 * index + 1];
        node.teamAId = teamA?.id;
        node.teamBId = teamB?.id;
      }

      // Wiring to parent match (winner advances)
      if (round < nRounds) {
        const parentRound = round + 1;
        const parentIndex = Math.floor(index / 2);
        node.parentMatchId = makeMatchId(parentRound, parentIndex);
        node.advancesToSlot = index % 2 === 0 ? "A" : "B";
      }

      matchesById[id] = node;
      ids.push(id);
    }

    roundMatchIds.push(ids);
  }

  // --- Feeder wiring (child knows its parents) ---
  // For round >= 2: match:r{round}:m{index} is fed by two matches in previous round:
  // prev indices: 2*index and 2*index+1
  for (let round = 2; round <= nRounds; round++) {
    const matchesThisRound = nTeams / Math.pow(2, round);
    for (let index = 0; index < matchesThisRound; index++) {
      const id = makeMatchId(round, index);
      const node = matchesById[id];
      if (!node) continue;

      const prevRound = round - 1;
      const feeder0 = makeMatchId(prevRound, 2 * index);
      const feeder1 = makeMatchId(prevRound, 2 * index + 1);

      const feeders: Id[] = [];
      if (matchesById[feeder0]) feeders.push(feeder0);
      if (matchesById[feeder1]) feeders.push(feeder1);

      node.feederMatchIds = feeders;
    }
  }

  return {
    size,
    teamsById,
    matchesById,
    roundMatchIds,
  };
}
