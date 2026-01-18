// frontend/components/HedgeDemoPanel.tsx

"use client";

import React, { useEffect, useRef, useState } from "react";
import type { Id } from "../bracket/types";
import type { BracketState } from "../bracket/types";
import type { EventMarket } from "../bracket/types";

type Step3Exposure = {
  teamName: string;
  yesTid: string;
  pPre: number;
  sharesYes: number;
};

type Step3CurrentRoundPosition = {
  matchId: Id;
  teamAName: string;
  teamBName: string;
  tokA: string;
  tokB: string;

  // current simulated holdings (YES/NO per token id)
  yesA: number;
  noA: number;
  yesB: number;
  noB: number;
};

type Step3GameOutcome = {
  outcome: "A" | "B";
  winningTeam: string;
  probsByYesTid: Record<string, number>;
  portfolioValue: number;
};

type Step3GameImpact = {
  label: string;
  matchId: Id;
  teamAName: string;
  teamBName: string;
  tokA: string;
  tokB: string;
  pGamePreA: number;
  pGamePreB: number;
  outcomeA: Step3GameOutcome;
  outcomeB: Step3GameOutcome;
  hedgeAmount: number; // V_B - V_A
};

type Step3CurrentGame = Step3GameImpact;

type Step3Snapshot = {
  builtAtMs: number;
  exposures: Step3Exposure[];
  currentRoundPositions: Step3CurrentRoundPosition[];
  currentGames: Step3CurrentGame[];
  games: Step3GameImpact[]; // (temporary) full list / debug
};

type Step3Trade = {
  matchId: Id;
  sideTokenId: string;
  side: "YES";
  shares: number;
  note: string;
};

type Props = {
  bracket: BracketState;

  // simulated positions
  simPosByTokenId: Record<string, { yes: number; no: number }>;
  addSimPosition: (tokenId: string, side: "YES" | "NO", qty: number) => void;

  // pricing
  midByTokenId: Record<string, string>;

  // USDC
  usdcBalance: number;
  setUsdcBalance: React.Dispatch<React.SetStateAction<number>>;

  // helpers (passed through for now)
  getMid: (tokenId: string) => number | null;
  fmtPct: (x?: string | null) => string | null;
  fmtShares: (x: number) => string;
  computeCostUsd: (
    midStr: string | undefined,
    side: "YES" | "NO",
    shares: number,
  ) => number | null;
  norm: (s: string) => string;

  // merge / normalize ops (demo steps 1 & 2)
  mergeAllPossible: () => { usdcBack: number; lines: string[] };
  normalizeAllEventNoToYes: () => { converted: number };

  // NEW: previews (dry-run; must not mutate)
  previewMergeAllPossible: () => { usdcBack: number; lines: string[] };
  previewNormalizeAllEventNoToYes: () => { converted: number; lines: string[] };

  // (optional but recommended for step 3/4 too)
  previewComputeHedge?: () => { lines: string[] };
  previewNetComplementary?: () => { lines: string[] };
};

type Step3ExampleOutcomeUi = {
  label: string; // "If Rams wins" etc
  newProb: number; // 0..1
  valueUsd: number; // expected value in $ (shares * prob * $1)
  deltaUsd: number; // vs baseline
};

type Step3ExampleGameUi = {
  matchup: string;
  pA: number;
  pB: number;
  teamA: string;
  teamB: string;
  baselineUsd: number;

  outcomeA: Step3ExampleOutcomeUi; // A wins
  outcomeB: Step3ExampleOutcomeUi; // B wins

  hedgeH: number; // VB - VA
};

type Step3ExampleUi = {
  positionTitle: string;
  shares: number;
  pUi: number | null;
  pNorm: number;
  baselineUsd: number;
  games: Step3ExampleGameUi[];
};

export function HedgeDemoPanel(props: Props) {
  const {
    bracket,
    simPosByTokenId,
    addSimPosition,
    midByTokenId,
    usdcBalance,
    setUsdcBalance,
    getMid,
    fmtPct,
    fmtShares,
    computeCostUsd,
    norm,
    mergeAllPossible,
    normalizeAllEventNoToYes,
    previewMergeAllPossible,
    previewNormalizeAllEventNoToYes,
    previewComputeHedge,
    previewNetComplementary,
  } = props;

  // Always-latest refs to avoid stale state in click handlers (Step 3)
  const simPosRef = useRef(simPosByTokenId);
  const midByTidRef = useRef(midByTokenId);

  const [step3ExampleUi, setStep3ExampleUi] = useState<Step3ExampleUi | null>(
    null,
  );

  useEffect(() => {
    simPosRef.current = simPosByTokenId;
  }, [simPosByTokenId]);

  useEffect(() => {
    midByTidRef.current = midByTokenId;
  }, [midByTokenId]);

  const [hedgeOpen, setHedgeOpen] = useState(true);
  const [step3Snapshot, setStep3Snapshot] = useState<Step3Snapshot | null>(
    null,
  );

  const [step3RecommendedTrades, setStep3RecommendedTrades] = useState<
    Step3Trade[]
  >([]);

  type HedgeStep = {
    id:
      | "mergePairs"
      | "normalizeExposure"
      | "computeHedge"
      | "netComplementary";
    title: string;
    text: string;
    requiresAction?: boolean;
    actionLabel?: string;
  };

  const HEDGE_STEPS: HedgeStep[] = [
    {
      id: "mergePairs",
      title: "Step 1 - Clean Up Paired Positions",
      text:
        "Before we think about hedging or probabilities, we need to clean up the positions you already have. " +
        "On prediction markets, a YES share and a NO share on the same market are opposites: together, they always pay out exactly $1, no matter what happens. " +
        "That means if you hold both sides, that portion of your position is completely risk-free — it is no longer a bet on an outcome.\n\n" +
        "If we leave these paired positions untouched, they make your portfolio look more complicated and risky than it really is. " +
        "Later hedging logic would treat them as exposure, even though they cannot actually gain or lose value. " +
        "So the first thing we do is merge these YES/NO pairs, turn them into guaranteed value, and remove them from consideration. " +
        "What remains after this step is your true directional exposure — the part of your portfolio that genuinely depends on game outcomes and actually needs hedging.\n\n" +
        "In short, Step 1 removes fake risk so the rest of the hedging process only deals with real risk.",
      requiresAction: true,
      actionLabel: "Preview Cleanup",
    },
    {
      id: "normalizeExposure",
      title: "Step 2 — Normalize to True Exposure",
      text:
        "Step 2 turns your positions into a simpler, apples-to-apples view.\n\n" +
        "What you have right now can be a mix of YES and NO tokens across the event.\n" +
        "For beginners, that’s hard to reason about.\n\n" +
        "In this demo, we convert every NO position into YES exposure on the OTHER teams.\n" +
        "That way, after Step 2 you can read your exposure as:\n" +
        "• “I effectively own X YES shares of Team A winning”\n" +
        "• “I effectively own Y YES shares of Team B winning”\n\n" +
        "Mini-example:\n" +
        "• If you own 10 NO on “Rams win Super Bowl,”\n" +
        "that means you benefit if any other team wins\n" +
        "→ so we convert it into YES exposure across the rests (demo rule).\n\n",
      requiresAction: true,
      actionLabel: "Compute normalized exposure",
    },

    {
      id: "computeHedge",
      title: "Step 3 — Compute Hedges",
      text:
        "In this step, Correl looks at how today’s games affect your later-round positions.\n\n" +
        "You hold shares in an event market (like winning the Finals). Those shares gain or lose value when current games resolve, because each result changes who is still likely to win later rounds.\n\n" +
        "For each active game, Correl compares two outcomes:\n" +
        "• What your portfolio is worth if Team A wins\n" +
        "• What your portfolio is worth if Team B wins\n\n" +
        "To compute this, Correl starts from the current game’s market odds and propagates that result forward:\n" +
        "• If a team wins, its later-round probability is scaled up by 1 ÷ its game win probability\n" +
        "• The losing team’s later-round probability goes to 0\n" +
        "• All other teams stay the same\n" +
        "• Then everything is renormalized so probabilities sum to 100%\n\n" +
        "This gives two possible future probability worlds — one for each game outcome. " +
        "Correl converts those probability shifts into portfolio values and measures the swing between them.\n\n" +
        "If one result makes your portfolio much better than the other, that difference is risk. " +
        "Correl hedges that risk by buying shares in the current game market, so your profit or loss is more balanced no matter who wins.\n\n" +
        "Mini-example:\n" +
        "• Team A has a 40% chance to win today’s game\n" +
        "• Team A’s Finals probability is 20%\n" +
        "• If Team A wins, its Finals probability becomes 20% ÷ 0.40 = 50%\n" +
        "• All teams are then renormalized to sum to 100%",
      requiresAction: true,
      actionLabel: "Compute hedge trades",
    },
    {
      id: "netComplementary",
      title: "Done",
      text:
        "🎉 Congratulations!\n\n" +
        "Your positions are now fully hedged.\n\n" +
        "You’ve eliminated unnecessary risk and balanced your portfolio so that outcomes are much more stable no matter how the remaining games resolve.\n\n" +
        "You can safely close this window and continue trading with confidence.",
      requiresAction: false,
    },
  ];

  const [hedgeTutorOpen, setHedgeTutorOpen] = useState(false);
  const [hedgeStepIdx, setHedgeStepIdx] = useState(0);
  const [hedgeTyped, setHedgeTyped] = useState("");
  const [awaitMode, setAwaitMode] = useState<"preview" | "execute">("preview");
  const [hedgeTextOverrideByStepId, setHedgeTextOverrideByStepId] = useState<
    Partial<Record<HedgeStep["id"], string>>
  >({});
  const [stepHasActionsById, setStepHasActionsById] = useState<
    Partial<Record<HedgeStep["id"], boolean>>
  >({});
  const [step3Subpage, setStep3Subpage] = useState<
    "none" | "example" | "trades"
  >("none");

  const [hedgePhase, setHedgePhase] = useState<
    "typing" | "await_action" | "done"
  >("typing");
  const [hedgeNotes, setHedgeNotes] = useState<string[]>([]);

  function getFinalEventMatch(): {
    matchId: Id;
    markets: EventMarket[];
  } | null {
    // Find any match that has an attached EVENT (your finals futures)
    for (const matchId of Object.keys(bracket.matchesById)) {
      const m = bracket.matchesById[matchId];
      const markets = m.market?.event?.markets;
      if (Array.isArray(markets) && markets.length >= 2) {
        return { matchId: matchId as Id, markets };
      }
    }
    return null;
  }

  function fmtUsd(x: number): string {
    return `$${x.toFixed(2)}`;
  }

  function fmtUsdSigned(x: number): { text: string; isPos: boolean } {
    const isPos = x >= 0;
    const sign = isPos ? "+" : "−";
    return { text: `${sign}${fmtUsd(Math.abs(x))}`, isPos };
  }

  function pickPrimaryFinalTeam(eventMarkets: EventMarket[]): {
    name: string;
    yesTid: string;
    noTid: string | null;
    sharesYes: number;
  } | null {
    // Choose team with the largest YES position among event YES tokenIds
    let best: {
      name: string;
      yesTid: string;
      noTid: string | null;
      sharesYes: number;
    } | null = null;

    for (const mk of eventMarkets) {
      const yesTid = mk?.clobTokenIds?.[0] ? String(mk.clobTokenIds[0]) : null;
      if (!yesTid) continue;

      const sharesYes = simPosByTokenId[yesTid]?.yes ?? 0;
      const name = (mk.title ?? "").trim() || "Team";

      if (!best || sharesYes > best.sharesYes) {
        best = {
          name,
          yesTid,
          noTid: mk?.clobTokenIds?.[1] ? String(mk.clobTokenIds[1]) : null,
          sharesYes,
        };
      }
    }

    // If user holds none, still pick the first market so the demo can run
    if (!best || best.sharesYes <= 0) {
      const mk = eventMarkets[0];
      const yesTid = mk?.clobTokenIds?.[0] ? String(mk.clobTokenIds[0]) : null;
      if (!yesTid) return null;
      best = {
        name: (mk.title ?? "").trim() || "Team",
        yesTid,
        noTid: mk?.clobTokenIds?.[1] ? String(mk.clobTokenIds[1]) : null,
        sharesYes: simPosByTokenId[yesTid]?.yes ?? 0,
      };
    }

    return best;
  }

  function buildTournamentPreProbsFromFinalEvent(
    eventMarkets: EventMarket[],
  ): Array<{ title: string; yesTid: string; pPre: number }> {
    const rows: Array<{ title: string; yesTid: string; pPre: number }> = [];

    for (const mk of eventMarkets) {
      const yesTid = mk?.clobTokenIds?.[0] ? String(mk.clobTokenIds[0]) : null;
      if (!yesTid) continue;

      const p = getMid(yesTid);
      if (p === null) continue;

      rows.push({ title: (mk.title ?? "").trim() || "Team", yesTid, pPre: p });
    }

    // Normalize (in case prices don’t sum to 1 exactly)
    const sum = rows.reduce((acc, r) => acc + r.pPre, 0);
    if (sum > 0) {
      for (const r of rows) r.pPre = r.pPre / sum;
    }

    return rows;
  }

  function portfolioValueFromTournamentProbs(
    probsByYesTid: Record<string, number>,
    exposures: Step3Exposure[],
  ): number {
    let V = 0;
    for (const e of exposures) {
      const P = probsByYesTid[e.yesTid] ?? 0;
      if (e.sharesYes <= 0) continue;
      V += e.sharesYes * P;
    }
    return V;
  }

  function computeTournamentProbsAfterGameOutcome(params: {
    finalPre: Array<{ title: string; yesTid: string; pPre: number }>;
    gameTeamsYesTids: { aYesTid: string; bYesTid: string };
    // outcome: "A" means team A wins, "B" means team B wins
    outcome: "A" | "B";
    // pPre for the game itself (from game market)
    pGamePreA: number;
    pGamePreB: number;
  }): Record<string, number> {
    const { finalPre, gameTeamsYesTids, outcome, pGamePreA, pGamePreB } =
      params;

    // Your multipliers:
    // if resolved to A wins: M_A = 1/pPreA, M_B = 0, others 1
    // if resolved to B wins: M_B = 1/pPreB, M_A = 0, others 1

    const M: Record<string, number> = {};
    for (const r of finalPre) M[r.yesTid] = 1;

    if (outcome === "A") {
      M[gameTeamsYesTids.aYesTid] = pGamePreA > 0 ? 1 / pGamePreA : 0;
      M[gameTeamsYesTids.bYesTid] = 0;
    } else {
      M[gameTeamsYesTids.bYesTid] = pGamePreB > 0 ? 1 / pGamePreB : 0;
      M[gameTeamsYesTids.aYesTid] = 0;
    }

    // P_T = (Ppre_T * M_T) / sum_i(Ppre_i * M_i)
    const numer: Record<string, number> = {};
    let denom = 0;
    for (const r of finalPre) {
      const x = r.pPre * (M[r.yesTid] ?? 1);
      numer[r.yesTid] = x;
      denom += x;
    }

    const out: Record<string, number> = {};
    for (const r of finalPre) {
      out[r.yesTid] = denom > 0 ? numer[r.yesTid] / denom : 0;
    }
    return out;
  }

  function findEventMarketsGroupByYesTid(yesTid: string): EventMarket[] | null {
    const target = String(yesTid);

    for (const matchId of Object.keys(bracket.matchesById)) {
      const m = bracket.matchesById[matchId];
      const markets = m.market?.event?.markets;
      if (!Array.isArray(markets) || markets.length < 2) continue;

      for (const mk of markets) {
        const tid = mk?.clobTokenIds?.[0] ? String(mk.clobTokenIds[0]) : null;
        if (tid && tid === target) return markets;
      }
    }

    return null;
  }

  function getCurrentActiveRound(): number | null {
    let best: number | null = null;

    for (const matchId of Object.keys(bracket.matchesById)) {
      const m = bracket.matchesById[matchId];
      if (!m) continue;

      // must be an unresolved match with both teams known
      if (m.winnerId) continue;
      if (!m.teamAId || !m.teamBId) continue;

      const r = m.round;
      if (typeof r !== "number") continue;

      if (best === null || r < best) best = r;
    }

    return best;
  }

  function pickGameExamplesForStep3(primaryTeamName: string): Array<{
    label: string;
    matchId: Id;
    teamAName: string;
    teamBName: string;
    tokA: string;
    tokB: string;
  }> {
    const games: Array<{
      label: string;
      matchId: Id;
      teamAName: string;
      teamBName: string;
      tokA: string;
      tokB: string;
    }> = [];

    // Look for normal (non-event) game markets with 2 clobTokenIds
    const candidates: Array<{
      matchId: Id;
      teamAName: string;
      teamBName: string;
      tokA: string;
      tokB: string;
    }> = [];

    for (const matchId of Object.keys(bracket.matchesById)) {
      const m = bracket.matchesById[matchId];
      if (!m.market) continue;
      if (m.market.event) continue; // game markets only
      const toks = m.market.clobTokenIds;
      if (!Array.isArray(toks) || toks.length < 2) continue;

      const aId = m.teamAId;
      const bId = m.teamBId;
      const aName = aId ? bracket.teamsById[aId]?.name : "";
      const bName = bId ? bracket.teamsById[bId]?.name : "";
      if (!aName || !bName) continue;

      candidates.push({
        matchId: matchId as Id,
        teamAName: aName,
        teamBName: bName,
        tokA: String(toks[0]),
        tokB: String(toks[1]),
      });
    }

    // Primary example: a game involving the primary team name (substring match)
    const primary = candidates.find(
      (g) =>
        norm(g.teamAName).includes(norm(primaryTeamName)) ||
        norm(g.teamBName).includes(norm(primaryTeamName)),
    );
    if (primary) {
      games.push({
        label: "Primary game (involving your Finals example team)",
        ...primary,
      });
    }

    // Secondary example: another active game not involving that team
    const secondary = candidates.find(
      (g) =>
        !(
          norm(g.teamAName).includes(norm(primaryTeamName)) ||
          norm(g.teamBName).includes(norm(primaryTeamName))
        ),
    );
    if (secondary) {
      games.push({
        label:
          "Secondary game (doesn’t involve your Finals team, but still moves its odds via normalization)",
        ...secondary,
      });
    }

    return games;
  }

  function getCurrentRoundGameMarkets(): Array<{
    matchId: Id;
    teamAName: string;
    teamBName: string;
    tokA: string;
    tokB: string;
  }> {
    const currentRound = getCurrentActiveRound();
    if (currentRound === null) return [];

    const out: Array<{
      matchId: Id;
      teamAName: string;
      teamBName: string;
      tokA: string;
      tokB: string;
    }> = [];

    for (const matchId of Object.keys(bracket.matchesById)) {
      const m = bracket.matchesById[matchId];
      if (!m) continue;

      // only current round
      if (m.round !== currentRound) continue;

      // must be unresolved with both teams known
      if (m.winnerId) continue;
      if (!m.teamAId || !m.teamBId) continue;

      // must have a non-event (game) market with 2 token ids
      if (!m.market) continue;
      if (m.market.event) continue;

      const toks = m.market.clobTokenIds;
      if (!Array.isArray(toks) || toks.length < 2) continue;

      const aName = bracket.teamsById[m.teamAId]?.name ?? "";
      const bName = bracket.teamsById[m.teamBId]?.name ?? "";
      if (!aName || !bName) continue;

      out.push({
        matchId: matchId as Id,
        teamAName: aName,
        teamBName: bName,
        tokA: String(toks[0]),
        tokB: String(toks[1]),
      });
    }

    return out;
  }

  function collectHeldEventExposures(): Step3Exposure[] {
    const rows: Step3Exposure[] = [];

    // scan all matches for EVENT markets (non-game, e.g. finals winner, conference winner, etc.)
    for (const matchId of Object.keys(bracket.matchesById)) {
      const m = bracket.matchesById[matchId];
      const markets = m.market?.event?.markets;
      if (!Array.isArray(markets)) continue;

      for (const mk of markets) {
        const yesTid = mk?.clobTokenIds?.[0]
          ? String(mk.clobTokenIds[0])
          : null;
        if (!yesTid) continue;

        const sharesYes = simPosByTokenId[yesTid]?.yes ?? 0;
        if (sharesYes <= 0) continue; // only exposures we actually hold

        const p = getMid(yesTid);
        if (p === null) continue;

        rows.push({
          teamName: (mk.title ?? "").trim() || "Team",
          yesTid,
          pPre: p,
          sharesYes,
        });
      }
    }

    // If you want: de-dupe by yesTid (in case the same event market appears twice)
    const byTid: Record<string, Step3Exposure> = {};
    for (const r of rows) {
      const prev = byTid[r.yesTid];
      if (!prev) byTid[r.yesTid] = r;
      else
        byTid[r.yesTid] = { ...prev, sharesYes: prev.sharesYes + r.sharesYes };
    }

    return Object.values(byTid);
  }

  function buildDirectHedgesForCurrentRound(snap: Step3Snapshot): Step3Trade[] {
    const out: Step3Trade[] = [];

    for (const g of snap.currentRoundPositions) {
      const netA = (g.yesA ?? 0) - (g.noA ?? 0);
      const netB = (g.yesB ?? 0) - (g.noB ?? 0);

      const diff = netA - netB;
      if (Math.abs(diff) < 1e-12) continue;

      if (diff > 0) {
        // A payoff > B payoff → buy YES on B to catch up
        out.push({
          matchId: g.matchId,
          sideTokenId: g.tokB,
          side: "YES",
          shares: diff,
          note: `Direct hedge (${g.teamAName} vs ${g.teamBName}): buy ${fmtShares(
            diff,
          )} YES on ${g.teamBName} (equalize current-round payoff)`,
        });
      } else {
        const amt = -diff;
        // B payoff > A payoff → buy YES on A to catch up
        out.push({
          matchId: g.matchId,
          sideTokenId: g.tokA,
          side: "YES",
          shares: amt,
          note: `Direct hedge (${g.teamAName} vs ${g.teamBName}): buy ${fmtShares(
            amt,
          )} YES on ${g.teamAName} (equalize current-round payoff)`,
        });
      }
    }

    return out;
  }

  function buildModelHedgesForFutureRounds(snap: Step3Snapshot): Step3Trade[] {
    const out: Step3Trade[] = [];

    for (const g of snap.currentGames) {
      const h = g.hedgeAmount; // = V_B - V_A

      if (!Number.isFinite(h) || Math.abs(h) < 1e-12) continue;

      // Convention (same as your earlier text demo):
      // h = V_B - V_A
      // If h > 0, buy YES on A (tokA)
      // If h < 0, buy YES on B (tokB) for -h
      if (h > 0) {
        out.push({
          matchId: g.matchId,
          sideTokenId: g.tokA,
          side: "YES",
          shares: h,
          note: `Model hedge (${g.teamAName} vs ${g.teamBName}): buy ${fmtShares(
            h,
          )} YES on ${g.teamAName} (since V_B - V_A = ${h.toFixed(6)})`,
        });
      } else {
        const amt = -h;
        out.push({
          matchId: g.matchId,
          sideTokenId: g.tokB,
          side: "YES",
          shares: amt,
          note: `Model hedge (${g.teamAName} vs ${g.teamBName}): buy ${fmtShares(
            amt,
          )} YES on ${g.teamBName} (since V_B - V_A = ${h.toFixed(6)})`,
        });
      }
    }

    return out;
  }

  function buildStep3Snapshot(primaryYesTid: string): Step3Snapshot | null {
    const simPos = simPosRef.current;

    // --- SINGLE EVENT UNIVERSE ONLY ---
    // Find the specific EVENT market-group that contains the held yesTid.
    // This prevents mixing Super Bowl futures with conference futures, etc.
    const eventGroup = findEventMarketsGroupByYesTid(primaryYesTid);
    if (!eventGroup) return null;

    // Build tournament universe ONLY from this one event group
    const preRows = buildTournamentPreProbsFromFinalEvent(eventGroup);
    if (preRows.length < 2) return null;

    // Exposures: only held YES within this SAME event group
    const exposures: Step3Exposure[] = [];
    for (const r of preRows) {
      const heldYes = simPosRef.current[String(r.yesTid)]?.yes ?? 0;
      if (heldYes > 0) {
        exposures.push({
          teamName: r.title,
          yesTid: String(r.yesTid),
          pPre: Number(r.pPre),
          sharesYes: Number(heldYes),
        });
      }
    }
    if (exposures.length === 0) return null;

    // --- Current round games (same as before) ---
    const currentGamesRaw = getCurrentRoundGameMarkets();

    const currentRoundPositions: Step3CurrentRoundPosition[] =
      currentGamesRaw.map((g) => {
        const a = simPos[g.tokA] ?? { yes: 0, no: 0 };
        const b = simPos[g.tokB] ?? { yes: 0, no: 0 };

        return {
          matchId: g.matchId,
          teamAName: g.teamAName,
          teamBName: g.teamBName,
          tokA: g.tokA,
          tokB: g.tokB,
          yesA: a.yes ?? 0,
          noA: a.no ?? 0,
          yesB: b.yes ?? 0,
          noB: b.no ?? 0,
        };
      });

    const gameImpacts: Step3GameImpact[] = [];

    for (const g of currentGamesRaw) {
      const pA = getMid(g.tokA);
      const pB = getMid(g.tokB);
      if (pA === null || pB === null || pA <= 0 || pB <= 0) continue;

      // Map game teams -> tournament yesTid using the TABLE-derived titles
      const aFinal = preRows.find((r) =>
        norm(r.title).includes(norm(g.teamAName)),
      );
      const bFinal = preRows.find((r) =>
        norm(r.title).includes(norm(g.teamBName)),
      );
      if (!aFinal || !bFinal) continue;

      const probsIfA = computeTournamentProbsAfterGameOutcome({
        finalPre: preRows,
        gameTeamsYesTids: { aYesTid: aFinal.yesTid, bYesTid: bFinal.yesTid },
        outcome: "A",
        pGamePreA: pA,
        pGamePreB: pB,
      });

      const probsIfB = computeTournamentProbsAfterGameOutcome({
        finalPre: preRows,
        gameTeamsYesTids: { aYesTid: aFinal.yesTid, bYesTid: bFinal.yesTid },
        outcome: "B",
        pGamePreA: pA,
        pGamePreB: pB,
      });

      const V_A = portfolioValueFromTournamentProbs(probsIfA, exposures);
      const V_B = portfolioValueFromTournamentProbs(probsIfB, exposures);

      gameImpacts.push({
        label: `Current round game`,
        matchId: g.matchId,
        teamAName: g.teamAName,
        teamBName: g.teamBName,
        tokA: g.tokA,
        tokB: g.tokB,
        pGamePreA: pA,
        pGamePreB: pB,
        outcomeA: {
          outcome: "A",
          winningTeam: g.teamAName,
          probsByYesTid: probsIfA,
          portfolioValue: V_A,
        },
        outcomeB: {
          outcome: "B",
          winningTeam: g.teamBName,
          probsByYesTid: probsIfB,
          portfolioValue: V_B,
        },
        hedgeAmount: V_B - V_A,
      });
    }

    return {
      builtAtMs: Date.now(),
      exposures,
      currentRoundPositions,
      currentGames: gameImpacts,
      games: gameImpacts,
    };
  }

  function netAndConsolidateTrades(trades: Step3Trade[]): Step3Trade[] {
    // Sum shares per tokenId (YES-only for now)
    const byTokenId: Record<string, { shares: number; any: Step3Trade }> = {};

    for (const t of trades) {
      const tid = String(t.sideTokenId);
      if (!byTokenId[tid]) byTokenId[tid] = { shares: 0, any: t };
      byTokenId[tid].shares += t.shares;
    }

    const out: Step3Trade[] = [];
    for (const [tid, x] of Object.entries(byTokenId)) {
      const shares = x.shares;

      // drop near-zero (float noise)
      if (!Number.isFinite(shares) || Math.abs(shares) < 1e-9) continue;

      out.push({
        matchId: x.any.matchId, // for now we keep any matchId (not important after netting)
        sideTokenId: tid,
        side: "YES",
        shares,
        note: `Net buy: ${fmtShares(shares)} YES on token ${tid}`,
      });
    }

    // Optional: stable ordering largest first
    out.sort((a, b) => Math.abs(b.shares) - Math.abs(a.shares));

    return out;
  }

  function buildTokenLabelMapFromSnapshot(
    snap: Step3Snapshot,
  ): Record<string, { team: string; opponent: string; matchId: Id }> {
    const m: Record<string, { team: string; opponent: string; matchId: Id }> =
      {};

    for (const g of snap.currentGames) {
      m[String(g.tokA)] = {
        team: g.teamAName,
        opponent: g.teamBName,
        matchId: g.matchId,
      };
      m[String(g.tokB)] = {
        team: g.teamBName,
        opponent: g.teamAName,
        matchId: g.matchId,
      };
    }

    return m;
  }

  function applyRecommendedTrades(trades: Step3Trade[]): {
    applied: number;
    skipped: number;
    lines: string[];
  } {
    let applied = 0;
    let skipped = 0;
    const lines: string[] = [];

    for (const t of trades) {
      const tid = String(t.sideTokenId);
      const midStr = midByTokenId[tid];
      const cost = computeCostUsd(midStr, "YES", t.shares);

      if (cost === null || !Number.isFinite(cost)) {
        skipped += 1;
        lines.push(`Skip: price unavailable for token ${tid}.`);
        continue;
      }

      if (usdcBalance < cost) {
        skipped += 1;
        lines.push(
          `Skip: not enough USDC for ${fmtShares(t.shares)} YES (need $${cost.toFixed(
            2,
          )}, have $${usdcBalance.toFixed(2)}).`,
        );
        continue;
      }

      // Apply
      setUsdcBalance((b) => b - cost);
      addSimPosition(tid, "YES", t.shares);

      applied += 1;
      lines.push(
        `Bought ${fmtShares(t.shares)} YES (cost $${cost.toFixed(2)}) — token ${tid}.`,
      );
    }

    return { applied, skipped, lines };
  }

  function onExecuteRecommendedTrades() {
    if (step3RecommendedTrades.length === 0) {
      appendHedgeNote("No recommended trades to execute.");
      return;
    }

    const { applied, skipped, lines } = applyRecommendedTrades(
      step3RecommendedTrades,
    );

    appendHedgeNote(`Executed buys: applied ${applied}, skipped ${skipped}.`);
    for (const l of lines.slice(0, 12)) appendHedgeNote(l);
    if (lines.length > 12) appendHedgeNote(`…and ${lines.length - 12} more.`);

    // Prevent double-execution on accidental second click
    setStep3RecommendedTrades([]);
  }

  type Step3HoldingsRow = {
    team: string;
    yesTid: string;
    pPre: number | null;
    sharesYes: number;
  };

  function getUiMidRaw(yesTid: string): number | null {
    // Use the same mid string the UI uses
    const s =
      midByTidRef.current[String(yesTid)] ?? midByTokenId[String(yesTid)];
    if (!s) return null;
    const x = Number(s);
    return Number.isFinite(x) ? x : null;
  }

  function buildStep3HoldingsTable(): Step3HoldingsRow[] {
    const rows: Step3HoldingsRow[] = [];

    for (const matchId of Object.keys(bracket.matchesById)) {
      const m = bracket.matchesById[matchId];
      const ems = m.market?.event?.markets;
      if (!Array.isArray(ems)) continue;

      for (const mk of ems) {
        const yesTid = mk?.clobTokenIds?.[0]
          ? String(mk.clobTokenIds[0])
          : null;
        if (!yesTid) continue;

        const p = getUiMidRaw(yesTid);
        const sharesYes = simPosByTokenId[yesTid]?.yes ?? 0;

        rows.push({
          team: (mk.title ?? "").trim() || "Team",
          yesTid,
          pPre: p,
          sharesYes,
        });
      }
    }

    // dedupe by yesTid (same market can show up multiple times in the bracket)
    const byTid: Record<string, Step3HoldingsRow> = {};
    for (const r of rows) {
      if (!byTid[r.yesTid]) byTid[r.yesTid] = r;
    }

    return Object.values(byTid);
  }

  function buildStep3HoldingsTableFromRefs(): Step3HoldingsRow[] {
    const rows: Step3HoldingsRow[] = [];

    // local getMid that reads from the *ref* (not potentially stale props)
    function getMidFromRef(yesTid: string): number | null {
      const s = midByTidRef.current[String(yesTid)];
      if (!s) return null;
      const x = Number(s);
      return Number.isFinite(x) ? x : null;
    }

    const simPos = simPosRef.current;

    for (const matchId of Object.keys(bracket.matchesById)) {
      const m = bracket.matchesById[matchId];
      const ems = m.market?.event?.markets;
      if (!Array.isArray(ems)) continue;

      for (const mk of ems) {
        const yesTid = mk?.clobTokenIds?.[0]
          ? String(mk.clobTokenIds[0])
          : null;
        if (!yesTid) continue;

        const p = getMidFromRef(yesTid);
        const sharesYes = simPos[yesTid]?.yes ?? 0;

        rows.push({
          team: (mk.title ?? "").trim() || "Team",
          yesTid,
          pPre: p,
          sharesYes,
        });
      }
    }

    // dedupe by yesTid (same market can show up multiple times in the bracket)
    const byTid: Record<string, Step3HoldingsRow> = {};
    for (const r of rows) {
      if (!byTid[r.yesTid]) byTid[r.yesTid] = r;
    }

    return Object.values(byTid);
  }

  function printHoldingsTableNowToConsole() {
    const table = buildStep3HoldingsTableFromRefs();

    console.group("HEDGE POSITIONS CLICK — Step 3 holdings table");
    console.table(
      table.map((r) => ({
        Team: r.team,
        yesTid: r.yesTid,
        "P(pre)":
          r.pPre !== null ? Number((r.pPre * 100).toFixed(2)) + "%" : "—",
        "YES shares held": r.sharesYes,
      })),
    );
    console.groupEnd();
  }

  function findEventMarketTitleForYesTid(yesTid: string): string | null {
    const target = String(yesTid);

    for (const matchId of Object.keys(bracket.matchesById)) {
      const m = bracket.matchesById[matchId];
      const ems = m.market?.event?.markets;
      if (!Array.isArray(ems)) continue;

      for (const mk of ems) {
        const tid = mk?.clobTokenIds?.[0] ? String(mk.clobTokenIds[0]) : null;
        if (!tid) continue;
        if (tid !== target) continue;

        // Prefer the market question/title (your EventMarket likely uses mk.title for that)
        const title = (mk.title ?? "").trim();
        return title || null;
      }
    }

    return null;
  }

  function executeHedgeStep(stepId: HedgeStep["id"]) {
    if (stepId === "mergePairs") {
      const { usdcBack, lines } = mergeAllPossible();
      if (usdcBack <= 0) {
        appendHedgeNote("Step 1 executed: no mergeable pairs found.");
        return;
      }
      appendHedgeNote(
        `Step 1 executed: merged complete sets and returned $${usdcBack.toFixed(
          2,
        )} USDC.`,
      );
      for (const l of lines.slice(0, 12)) appendHedgeNote(l);
      if (lines.length > 12) appendHedgeNote(`…and ${lines.length - 12} more.`);
      return;
    }

    if (stepId === "normalizeExposure") {
      const { converted } = normalizeAllEventNoToYes();
      if (converted <= 0) {
        appendHedgeNote("Step 2 executed: no NO tokens found to normalize.");
        return;
      }
      appendHedgeNote(
        `Step 2 executed: normalized ${fmtShares(converted)} NO shares into YES across the remaining markets (demo equal-split).`,
      );
      return;
    }

    if (stepId === "computeHedge") {
      // 1) Build the same holdings table we trust
      const table = buildStep3HoldingsTable();

      // (Optional) keep your console table too
      console.group("STEP 3 — Holdings table (used for selection)");
      console.table(
        table.map((r) => ({
          Team: r.team,
          yesTid: r.yesTid,
          "P(pre)":
            r.pPre !== null ? Number((r.pPre * 100).toFixed(2)) + "%" : "—",
          "YES shares held": r.sharesYes,
        })),
      );
      console.groupEnd();

      // 2) Pick the first nonzero YES shares row
      const firstNonZero = table.find((r) => (r.sharesYes ?? 0) > 0);

      if (!firstNonZero) {
        // No holdings detected in the table -> preview can’t proceed
        const text =
          `Step 3 — What will change (preview)\n\n` +
          `No nonzero YES positions found in event markets.\n` +
          `Buy a YES position first, then rerun Step 3.\n`;
        setHedgeTextOverrideByStepId((prev) => ({
          ...prev,
          computeHedge: text,
        }));
        return;
      }

      // 3) Build snapshot using the chosen yesTid
      const snap = buildStep3Snapshot(firstNonZero.yesTid);
      if (!snap) {
        const text = `Step 3 — What will change (preview)\n\n`;
        setHedgeTextOverrideByStepId((prev) => ({
          ...prev,
          computeHedge: text,
        }));
        return;
      }

      setStep3Snapshot(snap);

      // 4) Compute trades
      const direct = buildDirectHedgesForCurrentRound(snap);
      const model = buildModelHedgesForFutureRounds(snap);
      const planned = [...direct, ...model];

      setStep3RecommendedTrades(planned);

      // 5) Build the preview page text in the exact format you asked for
      let text = `Step 3 - Compute Hedges\n\n`;
      text += `Step 3 — What will change (preview)\n\n`;
      const marketTitle =
        findEventMarketTitleForYesTid(firstNonZero.yesTid) ?? firstNonZero.team;

      text += `Demonstration market:\n`;
      text += `• ${marketTitle}\n`;
      text += `• Shares held: ${fmtShares(firstNonZero.sharesYes)}\n`;

      if (firstNonZero.pPre !== null) {
        text += `• Current implied P(pre) ≈ ${(firstNonZero.pPre * 100).toFixed(2)}%\n`;
      }
      text += `\nPlanned buys (before execution):\n`;
      if (planned.length === 0) {
        text += `• (none)\n`;
      } else {
        for (const t of planned.slice(0, 25)) {
          text += `• Buy ${fmtShares(t.shares)} YES — token ${t.sideTokenId}\n`;
        }
        if (planned.length > 25) text += `…and ${planned.length - 25} more.\n`;
      }

      setHedgeTextOverrideByStepId((prev) => ({ ...prev, computeHedge: text }));
      return;
    }

    if (stepId === "netComplementary") {
      if (step3RecommendedTrades.length === 0) {
        appendHedgeNote("Step 4: no recommended trades to net.");
        return;
      }

      const netted = netAndConsolidateTrades(step3RecommendedTrades);
      setStep3RecommendedTrades(netted);

      // Also show a clean summary in the tutor text (so user can see the result)
      let text = `Step 4 — Net & consolidate buys\n\n`;
      text += `Before: ${step3RecommendedTrades.length} trade(s)\n`;
      text += `After: ${netted.length} trade(s)\n\n`;
      text += `Recommended buys:\n`;

      const labelMap = step3Snapshot
        ? buildTokenLabelMapFromSnapshot(step3Snapshot)
        : {};

      for (const t of netted) {
        const info = labelMap[String(t.sideTokenId)];
        if (info) {
          text += `• Buy ${fmtShares(t.shares)} YES — ${info.team} (vs ${info.opponent})\n`;
        } else {
          text += `• Buy ${fmtShares(t.shares)} YES — tokenId ${t.sideTokenId}\n`;
        }
      }

      setHedgeTextOverrideByStepId((prev) => ({
        ...prev,
        netComplementary: text,
      }));

      appendHedgeNote(
        `Step 4 executed: consolidated to ${netted.length} trade(s).`,
      );
      return;
    }
  }

  function startHedgeTutor() {
    setHedgeTutorOpen(true);
    setHedgeStepIdx(0);
    setHedgeTyped("");
    setAwaitMode("preview"); // NEW
    setHedgePhase("typing");
    setHedgeNotes([]);
    setStep3Subpage("none");
  }

  function appendHedgeNote(line: string) {
    setHedgeNotes((prev) => [...prev, line]);
  }

  function advanceHedgeStep() {
    setHedgeTyped("");
    if (hedgeStepIdx + 1 >= HEDGE_STEPS.length) {
      setHedgePhase("done");
      return;
    }
    setHedgeStepIdx((i) => i + 1);
    setAwaitMode("preview"); // NEW (new step starts in preview mode)
    setHedgePhase("typing");
  }

  function resetHedgeSessionState() {
    setStep3Snapshot(null);
    setStep3RecommendedTrades([]);
    setHedgeTextOverrideByStepId({});
    setHedgeStepIdx(0);
    setAwaitMode("preview");
    setHedgePhase("typing");
    setHedgeTyped("");
    setHedgeNotes([]);
    setStep3Subpage("none");
  }

  function closeHedgePrompt() {
    setHedgeOpen(false);
    resetHedgeSessionState();
  }

  function runHedgeNow() {
    // Step 2 will compute + recommend token buys here.
    // For now, just close the prompt so UX is correct.
    setHedgeOpen(false);
  }

  function formatTradeLabel(t: Step3Trade): string {
    const labelMap = step3Snapshot
      ? buildTokenLabelMapFromSnapshot(step3Snapshot)
      : {};

    const info = labelMap[String(t.sideTokenId)];
    if (info) return `${info.team} (vs ${info.opponent})`;
    return `tokenId ${t.sideTokenId}`;
  }

  function q(s: string): string {
    return `"${s}"`;
  }

  function formatMatchup(team: string, opp: string): string {
    return `${team} (vs ${opp})`;
  }

  useEffect(() => {
    if (!hedgeTutorOpen) return;
    if (hedgePhase !== "typing") return;

    const step = HEDGE_STEPS[hedgeStepIdx];
    if (!step) return;

    let i = 0;
    const full = hedgeTextOverrideByStepId[step.id] ?? step.text;

    // How many characters per tick (tune this)
    const CHARS_PER_TICK = 4;

    // How fast each tick runs (ms)
    const TICK_MS = 4;

    const timer = window.setInterval(() => {
      i = Math.min(i + CHARS_PER_TICK, full.length);
      setHedgeTyped(full.slice(0, i));

      if (i >= full.length) {
        window.clearInterval(timer);

        // Text is fully visible → show buttons immediately
        setHedgePhase(step.requiresAction ? "await_action" : "typing");

        if (!step.requiresAction) {
          window.setTimeout(() => {
            advanceHedgeStep();
          }, 200);
        }
      }
    }, TICK_MS);

    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hedgeTutorOpen, hedgePhase, hedgeStepIdx]);

  // Step 3: when user switches from "example" -> "trades", build the trades page
  // in the *next render* (avoids stale closures from setTimeout handlers).
  useEffect(() => {
    if (!hedgeTutorOpen) return;

    const step = HEDGE_STEPS[hedgeStepIdx];
    if (step?.id !== "computeHedge") return;

    if (step3Subpage !== "trades") return;

    // Only build trades page if we haven't built it yet for this switch
    if (step3RecommendedTrades.length > 0) return;

    previewHedgeStep("computeHedge");
    setHedgePhase("typing");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step3Subpage, hedgeTutorOpen, hedgeStepIdx]);

  useEffect(() => {
    function onOpen() {
      printHoldingsTableNowToConsole();
      resetHedgeSessionState();

      setHedgeTutorOpen(false);
      setHedgePhase("typing");
      setHedgeStepIdx(0);
      setHedgeTyped("");
      setHedgeNotes([]);
      setHedgeOpen(true);
    }

    window.addEventListener("correl:open-hedge-demo", onOpen);
    return () => window.removeEventListener("correl:open-hedge-demo", onOpen);
  }, []);

  function buildStep3WorkedExampleTextFromTables(): {
    text: string;
    canContinueToTrades: boolean;
    ui: Step3ExampleUi | null;
  } {
    // 1) Finals/event truth table
    const holdings = buildStep3HoldingsTable();

    // Pick a REAL held position (first nonzero YES row)
    const pos = holdings.find((r) => (r.sharesYes ?? 0) > 0);
    if (!pos || !pos.yesTid) {
      return {
        text:
          "Worked example\n\n" +
          "No nonzero YES positions found in your event markets.\n" +
          "Buy a YES position first, then rerun Step 3.",
        canContinueToTrades: false,
        ui: null,
      };
    }

    // 2) Tournament probability universe = ONLY the single event group containing this held position
    const eventGroup = findEventMarketsGroupByYesTid(pos.yesTid);
    if (!eventGroup) {
      return {
        text:
          "Worked example\n\n" +
          "Couldn’t locate the specific event market group for your held position.\n" +
          "This usually means the event market isn’t attached consistently in the bracket.",
        canContinueToTrades: false,
        ui: null,
      };
    }

    const preRows = buildTournamentPreProbsFromFinalEvent(eventGroup);
    if (preRows.length < 2) {
      return {
        text:
          "Worked example\n\n" +
          "Not enough outcomes inside this single event market to build a probability universe.",
        canContinueToTrades: false,
        ui: null,
      };
    }

    // 3) Current round truth table
    const games = getCurrentRoundGameMarkets();

    // Need at least 2 active markets for your request
    if (games.length < 2) {
      return {
        text:
          "Worked example\n\n" +
          "Not enough active game markets in the current round (need at least 2) to show the example.",
        canContinueToTrades: false,
        ui: null,
      };
    }

    // Helper to map game team name -> tournament row using the EVENT table titles
    function mapTeamToTournamentYesTid(teamName: string): string | null {
      const hit = preRows.find((r) => norm(r.title).includes(norm(teamName)));
      return hit ? hit.yesTid : null;
    }

    // Select the first 2 games that map cleanly into the tournament table
    const picked: Array<{
      matchId: Id;
      teamAName: string;
      teamBName: string;
      tokA: string;
      tokB: string;
      aYesTid: string;
      bYesTid: string;
      pGameA: number;
      pGameB: number;
    }> = [];

    for (const g of games) {
      if (picked.length >= 2) break;

      const pA = getMid(g.tokA);
      const pB = getMid(g.tokB);
      if (pA === null || pB === null || pA <= 0 || pB <= 0) continue;

      const aYesTid = mapTeamToTournamentYesTid(g.teamAName);
      const bYesTid = mapTeamToTournamentYesTid(g.teamBName);
      if (!aYesTid || !bYesTid) continue;

      picked.push({
        matchId: g.matchId,
        teamAName: g.teamAName,
        teamBName: g.teamBName,
        tokA: g.tokA,
        tokB: g.tokB,
        aYesTid,
        bYesTid,
        pGameA: pA,
        pGameB: pB,
      });
    }

    if (picked.length < 2) {
      return {
        text:
          "Worked example\n\n" +
          "Couldn’t match 2 current games to teams in the event table (name mismatch).",
        canContinueToTrades: false,
        ui: null,
      };
    }

    // 4) Build the worked example text for the REAL held position
    const shares = Number(pos.sharesYes ?? 0);
    const posYesTid = String(pos.yesTid);

    // Baseline probability for the held team from the *normalized* tournament table
    const P0_norm = preRows.find((r) => r.yesTid === posYesTid)?.pPre ?? 0;

    // UI raw mid (optional, just for display/debug)
    const posRaw = holdings.find((r) => String(r.yesTid) === posYesTid);
    const P0_ui = posRaw?.pPre ?? null;

    const baselineUsd = shares * P0_norm;

    const uiGames: Step3ExampleGameUi[] = [];

    let text = "";
    text += `Worked example (from your real position)\n\n`;
    text += `Position:\n`;
    text += `• ${q(pos.team)}\n`;
    text += `• Shares: ${fmtShares(shares)}\n`;
    if (P0_ui !== null) {
      text += `• Current event probability (UI mid): ${(P0_ui * 100).toFixed(2)}%\n`;
    }
    text += `• Current event probability (normalized): ${(P0_norm * 100).toFixed(2)}%\n`;
    text += `• Baseline “unhedged value” ≈ shares × probability\n`;
    text += `  → ${fmtShares(shares)} × ${(P0_norm * 100).toFixed(2)}% ≈ ${(shares * P0_norm).toFixed(4)}\n\n`;

    text += `How one game changes later probabilities:\n`;
    text += `• Winner gets scaled by 1 ÷ (their game win probability)\n`;
    text += `• Loser goes to 0\n`;
    text += `• Everyone is then renormalized to sum to 100%\n\n`;

    // For EACH of the 2 games, compute held position P under A-wins vs B-wins,
    // compute unhedged swing, and show hedge-share calculation
    for (const [idx, g] of picked.entries()) {
      const probsIfA = computeTournamentProbsAfterGameOutcome({
        finalPre: preRows,
        gameTeamsYesTids: { aYesTid: g.aYesTid, bYesTid: g.bYesTid },
        outcome: "A",
        pGamePreA: g.pGameA,
        pGamePreB: g.pGameB,
      });

      const probsIfB = computeTournamentProbsAfterGameOutcome({
        finalPre: preRows,
        gameTeamsYesTids: { aYesTid: g.aYesTid, bYesTid: g.bYesTid },
        outcome: "B",
        pGamePreA: g.pGameA,
        pGamePreB: g.pGameB,
      });

      const PA = probsIfA[posYesTid] ?? 0;
      const PB = probsIfB[posYesTid] ?? 0;

      const VA = shares * PA;
      const VB = shares * PB;

      // Your convention: hedgeAmount = V_B - V_A
      const h = VB - VA;

      const V0 = shares * P0_norm;

      text += `Active market #${idx + 1}: ${q(
        `${g.teamAName} vs ${g.teamBName}`,
      )}\n`;
      text += `Game odds:\n`;
      text += `• P(${g.teamAName} wins) ≈ ${(g.pGameA * 100).toFixed(2)}%\n`;
      text += `• P(${g.teamBName} wins) ≈ ${(g.pGameB * 100).toFixed(2)}%\n\n`;

      // Show the “propagate” step explicitly for the teams in THIS game
      text += `Probability update rule for THIS game:\n`;
      text += `• If ${g.teamAName} wins: multiply ${g.teamAName} by (1 ÷ ${(g.pGameA * 100).toFixed(2)}%), set ${g.teamBName} to 0, then renormalize.\n`;
      text += `• If ${g.teamBName} wins: multiply ${g.teamBName} by (1 ÷ ${(g.pGameB * 100).toFixed(2)}%), set ${g.teamAName} to 0, then renormalize.\n\n`;

      // Now show the actual effect on YOUR held Finals position
      const dA = VA - V0;
      const dB = VB - V0;

      uiGames.push({
        matchup: `${g.teamAName} vs ${g.teamBName}`,
        pA: g.pGameA,
        pB: g.pGameB,
        teamA: g.teamAName,
        teamB: g.teamBName,
        baselineUsd,
        outcomeA: {
          label: `If ${g.teamAName} wins`,
          newProb: PA,
          valueUsd: VA,
          deltaUsd: dA,
        },
        outcomeB: {
          label: `If ${g.teamBName} wins`,
          newProb: PB,
          valueUsd: VB,
          deltaUsd: dB,
        },
        hedgeH: h,
      });

      function fmtSigned(x: number) {
        const s = x >= 0 ? "+" : "−";
        return `${s}${Math.abs(x).toFixed(4)}`;
      }

      text += `Effect on your position (${pos.team}):\n`;
      text += `Baseline value (right now): V0 = ${fmtShares(shares)} × ${(P0_norm * 100).toFixed(2)}% = ${V0.toFixed(4)}\n\n`;

      text += `If ${g.teamAName} wins:\n`;
      text += `• New P(${pos.team}) = ${(PA * 100).toFixed(2)}%\n`;
      text += `• Value = ${fmtShares(shares)} × ${(PA * 100).toFixed(2)}% = ${VA.toFixed(4)}\n`;
      text += `• Change vs baseline: ${fmtSigned(dA)}\n\n`;

      text += `If ${g.teamBName} wins:\n`;
      text += `• New P(${pos.team}) = ${(PB * 100).toFixed(2)}%\n`;
      text += `• Value = ${fmtShares(shares)} × ${(PB * 100).toFixed(2)}% = ${VB.toFixed(4)}\n`;
      text += `• Change vs baseline: ${fmtSigned(dB)}\n\n`;

      // Your hedge swing definition
      text += `Swing from this game (risk):\n`;
      text += `• h = V(${g.teamBName} wins) − V(${g.teamAName} wins)\n`;
      text += `  = ${VB.toFixed(4)} − ${VA.toFixed(4)} = ${h.toFixed(4)}\n\n`;

      // Hedge direction (your convention)
      text += `Hedge trade from this game:\n`;
      if (h > 0) {
        text += `• Since h > 0, ${g.teamBName} winning helps your Finals position more.\n`;
        text += `• To balance outcomes, buy ${h.toFixed(4)} ${formatMatchup(
          g.teamAName,
          g.teamBName,
        )}.\n\n`;
      } else if (h < 0) {
        const amt = -h;
        text += `• Since h < 0, ${g.teamAName} winning helps your Finals position more.\n`;
        text += `• To balance outcomes, buy ${amt.toFixed(4)} ${formatMatchup(
          g.teamBName,
          g.teamAName,
        )}.\n\n`;
      } else {
        text += `• h ≈ 0 → this game doesn’t materially change your Finals position value.\n\n`;
      }

      // Explicitly explain the “secondary game still affects Rams” point when it’s not involving the held team
      const involvesHeld =
        norm(g.teamAName).includes(norm(pos.team)) ||
        norm(g.teamBName).includes(norm(pos.team));

      if (!involvesHeld) {
        text += `Why this still moves ${pos.team}:\n`;
        text += `• Even though ${pos.team} isn’t playing here, the winner gets probability mass boosted (and the loser goes to 0).\n`;
        text += `• When we renormalize to 100%, that re-scales EVERY team’s probability — including ${pos.team}.\n\n`;
      }

      text += `---\n\n`;
    }

    text += `Next: Correl will compute these hedge buys across all active games and show the final recommended trades.\n`;

    return {
      text,
      canContinueToTrades: true,
      ui: {
        positionTitle: pos.team,
        shares,
        pUi: P0_ui,
        pNorm: P0_norm,
        baselineUsd,
        games: uiGames,
      },
    };
  }

  function previewHedgeStep(stepId: HedgeStep["id"]) {
    if (stepId === "mergePairs") {
      const { usdcBack, lines } = previewMergeAllPossible();
      let text = ``;

      const hasActions = lines.length > 0 && usdcBack > 0;
      setStepHasActionsById((prev) => ({ ...prev, mergePairs: hasActions }));

      if (lines.length === 0 || usdcBack <= 0) {
        text +=
          "We looked for positions where you hold BOTH sides of the same market (YES + NO).\n" +
          "Those pairs are risk-free, so we merge them and turn them into guaranteed USDC.\n\n" +
          "Result:\n" +
          "• No mergeable YES/NO pairs found.\n\n" +
          "That’s totally fine — it just means there’s nothing to clean up in Step 1.\n" +
          "Click Continue to move on.";
      } else {
        text +=
          "We looked for positions where you hold BOTH sides of the same market (YES + NO).\n" +
          "Those pairs are risk-free, so we merge them and turn them into guaranteed USDC.\n\n" +
          "Result:\n";

        for (const l of lines) text += `• ${l}\n`;
        text += `\nEstimated USDC returned: $${usdcBack.toFixed(2)}`;
      }

      setHedgeTextOverrideByStepId((prev) => ({ ...prev, mergePairs: text }));
      return;
    }

    if (stepId === "normalizeExposure") {
      const { converted, lines } = previewNormalizeAllEventNoToYes();
      let text = ``;

      if (converted <= 0) {
        text +=
          "At this point, we already know what your real exposure is.\n" +
          "This step just rewrites everything into a single direction (YES) so the next step is easier to reason about.\n\n" +
          "Result:\n" +
          "• No event NO tokens found to normalize.\n\n" +
          "That’s fine — your exposure is already clean.\n" +
          "Click Continue to move on.";
      } else {
        text +=
          "We now rewrite remaining NO positions into their equivalent YES exposure.\n" +
          "This doesn’t change your risk — it just puts everything in the same language for the next step.\n\n" +
          "Result:\n";

        for (const l of lines) text += `• ${l}\n`;
        text += `\nTotal NO shares converted: ${fmtShares(converted)}`;
      }

      setHedgeTextOverrideByStepId((prev) => ({
        ...prev,
        normalizeExposure: text,
      }));
      return;
    }

    if (stepId === "computeHedge") {
      // Page 1: Worked example (TABLE-DRIVEN)
      if (step3Subpage !== "trades") {
        const { text, canContinueToTrades, ui } =
          buildStep3WorkedExampleTextFromTables();

        setStep3ExampleUi(ui);

        // Make sure we do NOT show the trades panel yet
        setStep3RecommendedTrades([]);

        setStepHasActionsById((prev) => ({
          ...prev,
          computeHedge: canContinueToTrades,
        }));

        setStep3Subpage("example");
        setHedgeTextOverrideByStepId((prev) => ({
          ...prev,
          computeHedge: text,
        }));
        return;
      }

      // Page 2: Recommended trades (your existing logic, built from the table truth layer)
      const table = buildStep3HoldingsTable();
      const firstNonZero = table.find((r) => (r.sharesYes ?? 0) > 0);

      if (!firstNonZero) {
        setHedgeTextOverrideByStepId((prev) => ({
          ...prev,
          computeHedge:
            `Step 3 — What will change (preview)\n\n` +
            `No nonzero YES positions found in event markets.\n`,
        }));
        return;
      }

      const snap = buildStep3Snapshot(firstNonZero.yesTid);
      if (!snap) {
        setHedgeTextOverrideByStepId((prev) => ({
          ...prev,
          computeHedge:
            `Step 3 — What will change (preview)\n\n` +
            `Could not build snapshot from the table.\n`,
        }));
        return;
      }

      const direct = buildDirectHedgesForCurrentRound(snap);
      const model = buildModelHedgesForFutureRounds(snap);
      const trades = netAndConsolidateTrades([...direct, ...model]);

      let text = `Step 3 — What will change (preview)\n\n`;
      text += `All exposures (nonzero YES rows in this event):\n`;

      for (const e of snap.exposures) {
        text += `• ${e.teamName}\n`;
        text += `  • Shares held: ${fmtShares(e.sharesYes)}\n`;
        text += `  • Current implied probability ≈ ${(e.pPre * 100).toFixed(2)}%\n`;
      }

      text += `\nPlanned buys (before execution):\n`;

      const labelMap = buildTokenLabelMapFromSnapshot(snap);
      if (trades.length === 0) {
        text += `• (none)\n`;
      } else {
        for (const t of trades) {
          const info = labelMap[String(t.sideTokenId)];
          if (info)
            text += `• Buy ${fmtShares(t.shares)} YES — ${info.team} (vs ${info.opponent})\n`;
          else {
            for (const t of trades) {
              const info = labelMap[String(t.sideTokenId)];
              if (info) {
                text += `• Buy ${fmtShares(t.shares)} ${formatMatchup(
                  info.team,
                  info.opponent,
                )}\n`;
              } else {
                // User requested: never show token IDs
                text += `• Buy ${fmtShares(t.shares)} YES\n`;
              }
            }
          }
        }
      }

      setStep3Snapshot(snap);
      setStep3RecommendedTrades(trades);
      setHedgeTextOverrideByStepId((prev) => ({ ...prev, computeHedge: text }));
      return;
    }

    if (stepId === "netComplementary") {
      // Step 4 preview is basically: "here’s how your current recommended trades net down"
      const before = step3RecommendedTrades;
      const after = netAndConsolidateTrades(before);

      let text = `Step 4 — What will change (preview)\n\n`;
      text += `Before: ${before.length} trade(s)\nAfter: ${after.length} trade(s)\n\nResulting buys:\n`;

      const labelMap = step3Snapshot
        ? buildTokenLabelMapFromSnapshot(step3Snapshot)
        : {};
      for (const t of after) {
        const info = labelMap[String(t.sideTokenId)];
        if (info)
          text += `• Buy ${fmtShares(t.shares)} YES — ${info.team} (vs ${info.opponent})\n`;
        else
          text += `• Buy ${fmtShares(t.shares)} YES — tokenId ${t.sideTokenId}\n`;
      }

      setHedgeTextOverrideByStepId((prev) => ({
        ...prev,
        netComplementary: text,
      }));
      return;
    }
  }

  return (
    <>
      {/* Block the main UI while Hedging Assistant is running */}
      {hedgeTutorOpen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.08)",
            zIndex: 65,
            pointerEvents: "auto",
          }}
        />
      ) : null}

      {/* Hedge Positions prompt */}
      {hedgeOpen ? (
        <div
          onClick={closeHedgePrompt}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.25)",
            display: "grid",
            placeItems: "center",
            padding: 16,
            zIndex: 55,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(520px, 100%)",
              borderRadius: 16,
              border: "1px solid #ddd",
              background: "white",
              padding: 14,
              display: "grid",
              gap: 12,
              boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div style={{ fontWeight: 950, fontSize: 14 }}>
                Hedge Positions
              </div>
              <button
                onClick={closeHedgePrompt}
                style={{
                  fontSize: 14,
                  padding: "6px 10px",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  background: "white",
                  cursor: "pointer",
                  fontWeight: 900,
                }}
              >
                Close
              </button>
            </div>

            <div style={{ fontSize: 14, opacity: 0.85, lineHeight: 1.35 }}>
              Do you want to learn how Correl hedges?
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                onClick={() => {
                  setHedgeOpen(false);
                  startHedgeTutor();
                }}
                style={{
                  fontSize: 14,
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid #ddd",
                  background: "white",
                  cursor: "pointer",
                  fontWeight: 950,
                }}
              >
                Yes.
              </button>

              <button
                onClick={runHedgeNow}
                style={{
                  fontSize: 14,
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid #c9f2c9",
                  background: "#e9fbe9",
                  cursor: "pointer",
                  fontWeight: 950,
                }}
              >
                No, just do it.
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Bottom-right hedge tutor box */}
      {hedgeTutorOpen ? (
        <div
          style={{
            position: "fixed",
            right: 16,
            bottom: 16,
            width: 360,
            maxWidth: "calc(100vw - 32px)",
            maxHeight: "calc(100vh - 32px)",
            overflow: "auto",
            borderRadius: 16,
            border: "1px solid #ddd",
            background: "white",
            padding: 12,
            boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
            zIndex: 70,
            display: "grid",
            gap: 10,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <div style={{ fontWeight: 950, fontSize: 15 }}>
              Hedging Assistant
            </div>

            <button
              onClick={() => {
                setHedgeTutorOpen(false);
                resetHedgeSessionState();
              }}
              style={{
                fontSize: 14,
                padding: "4px 8px",
                borderRadius: 10,
                border: "1px solid #ddd",
                background: "white",
                cursor: "pointer",
                fontWeight: 900,
              }}
            >
              Close
            </button>
          </div>

          <div style={{ fontSize: 14, fontWeight: 900 }}>
            {HEDGE_STEPS[hedgeStepIdx]?.title ?? "Hedge"}
          </div>

          <div
            style={{
              fontSize: 15,
              opacity: 0.85,
              lineHeight: 1.35,
              minHeight: 46,
              whiteSpace: "pre-wrap",
            }}
          >
            {hedgeTyped}
            {hedgePhase === "typing" ? (
              <span style={{ opacity: 0.5 }}>▍</span>
            ) : null}
          </div>

          {/* Step 3 Worked Example payoffs (pretty UI) */}
          {HEDGE_STEPS[hedgeStepIdx]?.id === "computeHedge" &&
          step3Subpage === "example" &&
          step3ExampleUi ? (
            <div
              style={{
                border: "1px solid #eee",
                borderRadius: 12,
                padding: 10,
                display: "grid",
                gap: 10,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 950, opacity: 0.8 }}>
                Payoffs (Expected Value)
              </div>

              <div
                style={{
                  fontSize: 13,
                  lineHeight: 1.25,
                  display: "grid",
                  gap: 6,
                }}
              >
                <div
                  style={{ display: "flex", justifyContent: "space-between" }}
                >
                  <div style={{ opacity: 0.8 }}>Baseline (right now)</div>
                  <div style={{ fontWeight: 950 }}>
                    {fmtUsd(step3ExampleUi.baselineUsd)}
                  </div>
                </div>
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                {step3ExampleUi.games.map((g, idx) => {
                  const aSigned = fmtUsdSigned(g.outcomeA.deltaUsd);
                  const bSigned = fmtUsdSigned(g.outcomeB.deltaUsd);

                  return (
                    <div
                      key={`${g.matchup}-${idx}`}
                      style={{
                        border: "1px solid #f0f0f0",
                        borderRadius: 12,
                        padding: 10,
                        display: "grid",
                        gap: 8,
                      }}
                    >
                      <div style={{ display: "grid", gap: 2 }}>
                        <div style={{ fontSize: 13, fontWeight: 950 }}>
                          {g.matchup}
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.75 }}>
                          P({g.teamA} wins) ≈ {(g.pA * 100).toFixed(2)}% • P(
                          {g.teamB} wins) ≈ {(g.pB * 100).toFixed(2)}%
                        </div>
                      </div>

                      <div style={{ display: "grid", gap: 8 }}>
                        {/* Outcome A */}
                        <div
                          style={{
                            border: "1px solid #f3f3f3",
                            borderRadius: 10,
                            padding: 8,
                            display: "grid",
                            gap: 4,
                          }}
                        >
                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: 950,
                              opacity: 0.85,
                            }}
                          >
                            {g.outcomeA.label}
                          </div>

                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              fontSize: 13,
                            }}
                          >
                            <div style={{ opacity: 0.8 }}>
                              New P({step3ExampleUi.positionTitle})
                            </div>
                            <div style={{ fontWeight: 900 }}>
                              {(g.outcomeA.newProb * 100).toFixed(2)}%
                            </div>
                          </div>

                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              fontSize: 13,
                            }}
                          >
                            <div style={{ opacity: 0.8 }}>Value</div>
                            <div style={{ fontWeight: 900 }}>
                              {fmtUsd(g.outcomeA.valueUsd)}
                            </div>
                          </div>

                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              fontSize: 13,
                            }}
                          >
                            <div style={{ opacity: 0.8 }}>
                              Change vs baseline
                            </div>
                            <div
                              style={{
                                fontWeight: 950,
                                color: aSigned.isPos ? "#138A36" : "#B42318",
                              }}
                            >
                              {aSigned.text}
                            </div>
                          </div>
                        </div>

                        {/* Outcome B */}
                        <div
                          style={{
                            border: "1px solid #f3f3f3",
                            borderRadius: 10,
                            padding: 8,
                            display: "grid",
                            gap: 4,
                          }}
                        >
                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: 950,
                              opacity: 0.85,
                            }}
                          >
                            {g.outcomeB.label}
                          </div>

                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              fontSize: 13,
                            }}
                          >
                            <div style={{ opacity: 0.8 }}>
                              New P({step3ExampleUi.positionTitle})
                            </div>
                            <div style={{ fontWeight: 900 }}>
                              {(g.outcomeB.newProb * 100).toFixed(2)}%
                            </div>
                          </div>

                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              fontSize: 13,
                            }}
                          >
                            <div style={{ opacity: 0.8 }}>Value</div>
                            <div style={{ fontWeight: 900 }}>
                              {fmtUsd(g.outcomeB.valueUsd)}
                            </div>
                          </div>

                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              fontSize: 13,
                            }}
                          >
                            <div style={{ opacity: 0.8 }}>
                              Change vs baseline
                            </div>
                            <div
                              style={{
                                fontWeight: 950,
                                color: bSigned.isPos ? "#138A36" : "#B42318",
                              }}
                            >
                              {bSigned.text}
                            </div>
                          </div>
                        </div>

                        {/* Swing */}
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            fontSize: 13,
                          }}
                        >
                          <div style={{ opacity: 0.75 }}>
                            Swing (risk) from this game
                          </div>
                          <div style={{ fontWeight: 950 }}>
                            {fmtUsd(g.hedgeH)}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {step3RecommendedTrades.length > 0 ? (
            <div
              style={{
                border: "1px solid #eee",
                borderRadius: 12,
                padding: 10,
                display: "grid",
                gap: 6,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 950, opacity: 0.8 }}>
                Recommended trades
              </div>

              <div
                style={{
                  display: "grid",
                  gap: 6,
                  maxHeight: 160,
                  overflow: "auto",
                }}
              >
                {step3RecommendedTrades.slice(0, 20).map((t, idx) => (
                  <div
                    key={`${t.sideTokenId}-${idx}`}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      fontSize: 13,
                    }}
                  >
                    <div style={{ fontWeight: 900 }}>
                      Buy {fmtShares(t.shares)} YES
                    </div>
                    <div style={{ opacity: 0.75, textAlign: "right" }}>
                      {formatTradeLabel(t)}
                    </div>
                  </div>
                ))}

                {step3RecommendedTrades.length > 20 ? (
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    Showing first 20 of {step3RecommendedTrades.length}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {hedgePhase === "await_action" ? (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {(() => {
                const step = HEDGE_STEPS[hedgeStepIdx];
                const isStep3 = step?.id === "computeHedge";
                const hasProposedTrades = step3RecommendedTrades.length > 0;

                // Hide Preview Changes on Step 3 once proposed hedge trades appear
                // Step 3 has its own buttons:
                // - worked example page: show only "Continue to Recommended Trades"
                // - trades page: show only "Execute Trades"
                if (isStep3) {
                  if (step3Subpage === "example") return null;
                  if (hasProposedTrades) return null;
                }

                return (
                  <button
                    onClick={() => {
                      const step = HEDGE_STEPS[hedgeStepIdx];
                      if (!step) return;

                      // Step 3: only preview here (execution is handled by the separate Execute Trades button)
                      if (step.id === "computeHedge") {
                        previewHedgeStep(step.id);
                        setAwaitMode("preview");
                        setHedgePhase("typing");
                        return;
                      }

                      // First click: preview
                      if (awaitMode === "preview") {
                        previewHedgeStep(step.id);
                        setAwaitMode("execute");
                        setHedgePhase("typing");
                        return;
                      }

                      // Second click: either execute OR just continue (if no actions)
                      const hasActions = !!stepHasActionsById[step.id];

                      if (!hasActions) {
                        setAwaitMode("preview");
                        advanceHedgeStep();
                        return;
                      }

                      executeHedgeStep(step.id);
                      setAwaitMode("preview");
                      advanceHedgeStep();
                    }}
                    style={{
                      fontSize: 14,
                      padding: "12px 14px",
                      borderRadius: 12,
                      border: "1px solid #c9f2c9",
                      background: "#e9fbe9",
                      cursor: "pointer",
                      fontWeight: 950,
                    }}
                  >
                    {awaitMode === "preview"
                      ? "Preview Changes"
                      : stepHasActionsById[
                            HEDGE_STEPS[hedgeStepIdx]?.id ?? "mergePairs"
                          ]
                        ? "Execute Trades"
                        : "Continue"}
                  </button>
                );
              })()}
            </div>
          ) : null}

          {hedgePhase === "await_action" &&
          HEDGE_STEPS[hedgeStepIdx]?.id === "computeHedge" &&
          step3Subpage === "example" ? (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                onClick={() => {
                  // Switch the subpage. The useEffect will build the trades page
                  // after state updates (no stale closure).
                  setStep3RecommendedTrades([]); // ensure effect rebuilds the trades page
                  setStep3Subpage("trades");
                }}
                style={{
                  fontSize: 14,
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: "1px solid #c9f2c9",
                  background: "#e9fbe9",
                  cursor: "pointer",
                  fontWeight: 950,
                }}
              >
                Continue to Recommended Trades
              </button>
            </div>
          ) : null}

          {hedgePhase !== "typing" &&
          HEDGE_STEPS[hedgeStepIdx]?.id === "computeHedge" &&
          step3RecommendedTrades.length > 0 ? (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                onClick={() => {
                  onExecuteRecommendedTrades();

                  // Immediately go to Step 4
                  setAwaitMode("preview");
                  advanceHedgeStep();
                }}
                style={{
                  fontSize: 14,
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: "1px solid #c9f2c9",
                  background: "#e9fbe9",
                  cursor: "pointer",
                  fontWeight: 950,
                }}
              >
                Execute Trades ({step3RecommendedTrades.length})
              </button>
            </div>
          ) : null}

          {hedgePhase === "done" ? (
            <div style={{ fontSize: 14, fontWeight: 900, opacity: 0.85 }}>
              Congratualations! You hedged your first Polymarket position!
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
