// frontend/bracket/types.ts

export type BracketSize = 4 | 8 | 16 | 32 | 64;

export type Id = string;

export type Team = {
  id: Id;
  name: string;
};

export type MarketRef = {
  query: string;

  // Polymarket IDs / metadata
  marketId?: string;
  title?: string;
  slug?: string;
  conditionId?: string;
  clobTokenIds?: string[];

  // Optional: for multi-outcome markets (e.g., "Who will win the Super Bowl?")
  // If present, outcomes[i].tokenId should correspond to clobTokenIds[i].
  outcomes?: { name: string; tokenId: string }[];

  url?: string;

  venue?: "polymarket";
};

export type MatchNode = {
  id: Id;

  // 1 = first round, increases toward finals
  round: number;

  // index within the round (0..numMatchesInRound-1)
  index: number;

  // Teams assigned to this match (points to Team.id)
  teamAId?: Id;
  teamBId?: Id;

  // Winner (points to Team.id)
  winnerId?: Id;

  // NEW: for wiring: matches in the previous round that feed into this match.
  // Round 1: []
  // Round 2+: usually [prevMatchId0, prevMatchId1]
  feederMatchIds: Id[];

  // Keep these if you’re using them elsewhere; not required for the new logic
  // (You can delete later once everything uses feederMatchIds.)
  parentMatchId?: Id;
  advancesToSlot?: "A" | "B";

  // For multi-outcome markets: map each active team in this match -> the market's outcome tokenId
  // Example: { [teamId]: "12345" }
  outcomeTokenIdByTeamId?: Record<Id, string>;

  // Market attached to this match (filled later)
  market?: MarketRef;
};

export type BracketState = {
  size: BracketSize;

  // Stable registries
  teamsById: Record<Id, Team>;
  matchesById: Record<Id, MatchNode>;

  // Helpful for rendering
  roundMatchIds: Id[][]; // roundMatchIds[0] = round 1 matches, etc.
};
