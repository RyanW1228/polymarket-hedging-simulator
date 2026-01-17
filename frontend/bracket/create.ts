import type { BracketSize, BracketState, Id, MatchNode, Team } from "./types";

function makeId(prefix: string, n: number): Id {
  return `${prefix}_${n}`;
}

export function createBracketState(
  size: BracketSize,
  teamNames: string[],
): BracketState {
  // Fill up to `size`
  const names: string[] = [];
  for (let i = 0; i < size; i++) {
    names.push(teamNames[i] ?? `Team ${i + 1}`);
  }

  // Teams
  const teamsById: Record<Id, Team> = {};
  const teamIds: Id[] = [];
  for (let i = 0; i < size; i++) {
    const id = makeId("team", i);
    teamIds.push(id);
    teamsById[id] = { id, name: names[i] };
  }

  // Matches
  const matchesById: Record<Id, MatchNode> = {};
  const roundMatchIds: Id[][] = [];

  const rounds = Math.log2(size);

  // Round 1
  {
    const numMatches = size / 2;
    const ids: Id[] = [];
    for (let i = 0; i < numMatches; i++) {
      const id = makeId("match", Object.keys(matchesById).length);
      ids.push(id);

      matchesById[id] = {
        id,
        round: 1,
        index: i,
        teamAId: teamIds[2 * i],
        teamBId: teamIds[2 * i + 1],
        winnerId: undefined,
        feederMatchIds: [],
      };
    }
    roundMatchIds.push(ids);
  }

  // Round 2..N
  for (let r = 2; r <= rounds; r++) {
    const prevIds = roundMatchIds[r - 2];
    const numMatches = Math.ceil(prevIds.length / 2);

    const ids: Id[] = [];
    for (let i = 0; i < numMatches; i++) {
      const id = makeId("match", Object.keys(matchesById).length);
      ids.push(id);

      const feeder0 = prevIds[2 * i];
      const feeder1 = prevIds[2 * i + 1];

      const feederMatchIds: Id[] = [];
      if (feeder0) feederMatchIds.push(feeder0);
      if (feeder1) feederMatchIds.push(feeder1);

      matchesById[id] = {
        id,
        round: r,
        index: i,
        winnerId: undefined,
        feederMatchIds,
      };
    }
    roundMatchIds.push(ids);
  }

  return {
    size,
    teamsById,
    matchesById,
    roundMatchIds,
  };
}
