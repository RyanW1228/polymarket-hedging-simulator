import type { BracketState, Id } from "./types";

/**
 * ACTIVE teams = teams still alive for this match.
 * - If winnerId exists: [winnerId]
 * - Else:
 *   - Round 1 (no feeders): [teamAId, teamBId]
 *   - Round 2+: union of active teams of feeders
 */
export function getActiveTeamIdsForMatch(
  bracket: BracketState,
  matchId: Id,
): Id[] {
  const memo = new Map<Id, Id[]>();

  const dfs = (id: Id): Id[] => {
    const cached = memo.get(id);
    if (cached) return cached;

    const m = bracket.matchesById[id];
    if (!m) return [];

    if (m.winnerId) {
      const out = [m.winnerId];
      memo.set(id, out);
      return out;
    }

    const feeders = m.feederMatchIds ?? [];
    if (feeders.length === 0) {
      const out = [m.teamAId, m.teamBId].filter(Boolean) as Id[];
      memo.set(id, out);
      return out;
    }

    const set = new Set<Id>();
    for (const pid of feeders) {
      for (const tid of dfs(pid)) set.add(tid);
    }
    const out = Array.from(set);
    memo.set(id, out);
    return out;
  };

  return dfs(matchId);
}
