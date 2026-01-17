// frontend/bracket/types.ts

export type BracketSize = 4 | 8 | 16 | 32 | 64;

export type Id = string;

export type Team = {
  id: Id;
  name: string;
};

export type MarketRef = {
  // What the user typed (e.g., "Duke vs UNC winner")
  query: string;

  // Filled after search/attach
  marketId?: string;
  title?: string;

  // Optional fields you may attach later
  // (leave undefined until you have real Polymarket data)
  venue?: "polymarket";
  url?: string;
  yesTokenId?: string;
  noTokenId?: string;
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

  // For bracket wiring (where the winner advances)
  parentMatchId?: Id;
  advancesToSlot?: "A" | "B";

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
