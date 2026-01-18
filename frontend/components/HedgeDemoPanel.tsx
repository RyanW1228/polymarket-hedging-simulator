// frontend/components/HedgeDemoPanel.tsx

"use client";

import React, { useEffect, useState } from "react";
import type { Id } from "../bracket/types";
import type { BracketState } from "../bracket/types";
import type { EventMarket } from "../bracket/types";

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
  } = props;

  const [hedgeOpen, setHedgeOpen] = useState(false);

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
      title: "Step 1 — Merge YES/NO pairs",
      text: "All YES/NO pairs on the same binary market are merged into (a) risk-free complete sets and (b) any remaining directional exposure.",
      requiresAction: true,
      actionLabel: "Execute merge",
    },
    {
      id: "normalizeExposure",
      title: "Step 2 — Normalize to True Exposure",
      text:
        "For demonstrative purposes, we will convert all NO tokens into YES tokens of the remaining markets. " +
        "The resulting YES token amount represents the true exposure of each market.",
      requiresAction: true,
      actionLabel: "Compute normalized exposure",
    },
    {
      id: "computeHedge",
      title: "Step 3 — Compute hedges (main game markets)",
      text: "For each exposure component, we compute the needed hedge using your formula — and we only use the main game markets for best liquidity.",
      requiresAction: true,
      actionLabel: "Compute hedge trades",
    },
    {
      id: "netComplementary",
      title: "Step 4 — Net complementary hedges",
      text: "All complementary token positions are eliminated. If hedging says buy overlapping complementary positions, we net them down to the minimal set of buys.",
      requiresAction: true,
      actionLabel: "Net complementary buys",
    },
  ];

  const [hedgeTutorOpen, setHedgeTutorOpen] = useState(false);
  const [hedgeStepIdx, setHedgeStepIdx] = useState(0);
  const [hedgeTyped, setHedgeTyped] = useState("");
  const [hedgeTextOverrideByStepId, setHedgeTextOverrideByStepId] = useState<
    Partial<Record<HedgeStep["id"], string>>
  >({});

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
  ): number {
    // V = sum_T s_T * P_T, where s_T is Final YES shares held for team T
    let V = 0;
    for (const [yesTid, P] of Object.entries(probsByYesTid)) {
      const s = simPosByTokenId[yesTid]?.yes ?? 0;
      if (s <= 0) continue;
      V += s * P;
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

  function buildStep3TextAndTrades(): {
    text: string;
    trades: Array<{
      matchId: Id;
      sideTokenId: string;
      side: "YES";
      shares: number;
      note: string;
    }>;
  } {
    const finalEvent = getFinalEventMatch();
    if (!finalEvent) {
      return {
        text: "Step 3 — Compute hedges\n\nNo Final EVENT is attached yet, so I can’t demonstrate tournament hedging. Attach a Final/semis EVENT market first.",
        trades: [],
      };
    }

    const finalPre = buildTournamentPreProbsFromFinalEvent(finalEvent.markets);
    if (finalPre.length < 2) {
      return {
        text: "Step 3 — Compute hedges\n\nFinal EVENT markets are missing prices/tokenIds, so I can’t compute tournament probabilities yet.",
        trades: [],
      };
    }

    const primary = pickPrimaryFinalTeam(finalEvent.markets);
    if (!primary) {
      return {
        text: "Step 3 — Compute hedges\n\nCouldn’t pick a Finals example team (missing token ids).",
        trades: [],
      };
    }

    const games = pickGameExamplesForStep3(primary.name);
    if (games.length === 0) {
      return {
        text: `Step 3 — Compute hedges\n\nI found a Finals example team (“${primary.name}”), but I can’t find any attached *game* markets (non-event) to hedge with.`,
        trades: [],
      };
    }

    const trades: Array<{
      matchId: Id;
      sideTokenId: string;
      side: "YES";
      shares: number;
      note: string;
    }> = [];

    let text = `Step 3 — Compute hedges (using only game markets)\n\n`;
    text += `Finals example team: ${primary.name}\n`;
    text += `Finals position (YES shares): ${fmtShares(primary.sharesYes)}\n\n`;
    text += `We’ll compute a hedge one game at a time using:\n`;
    text += `• Tournament update: prior × likelihood ratio, then normalize\n`;
    text += `• Hedge size: h = V_Y − V_X (then buy YES on one side to equalize outcomes)\n\n`;

    for (const g of games.slice(0, 2)) {
      const pA = getMid(g.tokA);
      const pB = getMid(g.tokB);
      if (pA === null || pB === null || pA <= 0 || pB <= 0) {
        text += `\n${g.label}\nGame: ${g.teamAName} vs ${g.teamBName}\n`;
        text += `Missing game probabilities, so I can’t compute V_A/V_B.\n`;
        continue;
      }

      // Map game teams -> Finals YES tokenIds (by matching titles)
      // We locate the Finals market whose title contains the team name.
      const aFinal = finalPre.find((r) =>
        norm(r.title).includes(norm(g.teamAName)),
      );
      const bFinal = finalPre.find((r) =>
        norm(r.title).includes(norm(g.teamBName)),
      );

      if (!aFinal || !bFinal) {
        text += `\n${g.label}\nGame: ${g.teamAName} vs ${g.teamBName}\n`;
        text += `I couldn’t match one/both teams to the Finals event markets, so I can’t run the formula.\n`;
        continue;
      }

      const probsIfA = computeTournamentProbsAfterGameOutcome({
        finalPre,
        gameTeamsYesTids: { aYesTid: aFinal.yesTid, bYesTid: bFinal.yesTid },
        outcome: "A",
        pGamePreA: pA,
        pGamePreB: pB,
      });

      const probsIfB = computeTournamentProbsAfterGameOutcome({
        finalPre,
        gameTeamsYesTids: { aYesTid: aFinal.yesTid, bYesTid: bFinal.yesTid },
        outcome: "B",
        pGamePreA: pA,
        pGamePreB: pB,
      });

      const V_A = portfolioValueFromTournamentProbs(probsIfA);
      const V_B = portfolioValueFromTournamentProbs(probsIfB);

      // Payoff diagram (unhedged)
      const primaryProbIfA = probsIfA[primary.yesTid] ?? 0;
      const primaryProbIfB = probsIfB[primary.yesTid] ?? 0;

      text += `\n${g.label}\n`;
      text += `Game market: ${g.teamAName} vs ${g.teamBName}\n`;
      text += `Pre-game probs: ${g.teamAName} ${fmtPct(String(pA)) ?? ""}  |  ${g.teamBName} ${fmtPct(String(pB)) ?? ""}\n\n`;

      text += `Payoff diagram (how this game moves your Finals exposure):\n`;
      text += `Outcome A wins:  P(${primary.name}) = ${(primaryProbIfA * 100).toFixed(2)}%   Portfolio V_A = ${V_A.toFixed(4)}\n`;
      text += `Outcome B wins:  P(${primary.name}) = ${(primaryProbIfB * 100).toFixed(2)}%   Portfolio V_B = ${V_B.toFixed(4)}\n\n`;

      // Hedge: equalize net values across outcomes using only this game market
      // Use "YES on teamA wins game" as the instrument, then:
      // hA = V_B - V_A. If positive => buy hA YES(teamA). If negative => buy -hA YES(teamB).
      const hA = V_B - V_A;

      if (Math.abs(hA) < 1e-9) {
        text += `Hedge result: already neutral to this game under the model (V_A ≈ V_B).\n`;
        continue;
      }

      if (hA > 0) {
        trades.push({
          matchId: g.matchId,
          sideTokenId: g.tokA,
          side: "YES",
          shares: hA,
          note: `Hedge ${g.teamAName} vs ${g.teamBName}: buy ${fmtShares(hA)} YES on ${g.teamAName} (equalize V across outcomes)`,
        });
        text += `Hedge (one-game): h = V_B − V_A = ${hA.toFixed(4)}\n`;
        text += `→ Buy ${fmtShares(hA)} YES on “${g.teamAName} wins this game”.\n`;
        text += `This equalizes net value across the two game outcomes under the model.\n`;
      } else {
        const amt = -hA;
        trades.push({
          matchId: g.matchId,
          sideTokenId: g.tokB,
          side: "YES",
          shares: amt,
          note: `Hedge ${g.teamAName} vs ${g.teamBName}: buy ${fmtShares(amt)} YES on ${g.teamBName} (equalize V across outcomes)`,
        });
        text += `Hedge (one-game): h = V_B − V_A = ${hA.toFixed(4)}\n`;
        text += `→ Buy ${fmtShares(amt)} YES on “${g.teamBName} wins this game” (equivalently: buy NO on ${g.teamAName}).\n`;
        text += `This equalizes net value across the two game outcomes under the model.\n`;
      }

      // Explicitly call out the “other game moves your team via normalization” intuition
      if (
        !norm(g.teamAName).includes(norm(primary.name)) &&
        !norm(g.teamBName).includes(norm(primary.name))
      ) {
        text += `\nNote: ${primary.name} isn’t playing here. Its probability still changes because the denominator (normalization over alive teams) changes when another team’s multiplier becomes 0 or 1/p.\n`;
      }
    }

    text += `\n(For demo) We repeat this per active game. Because the multipliers are independent per game, hedging game-by-game matches the joint optimum under this model.\n`;

    return { text, trades };
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
      const { text, trades } = buildStep3TextAndTrades();

      // Show the computed explanation + payoff diagram directly in the tutor text
      setHedgeTextOverrideByStepId((prev) => ({ ...prev, computeHedge: text }));

      // Optionally: actually apply the hedge trades as simulated buys (so user "watches" the assistant hedge)
      // This uses your existing simulated cost model from midpoints (YES price = midpoint).
      for (const t of trades) {
        const midStr = midByTokenId[String(t.sideTokenId)];
        const cost = computeCostUsd(midStr, "YES", t.shares);
        if (cost === null) continue;
        if (usdcBalance < cost) continue;

        setUsdcBalance((b) => b - cost);
        addSimPosition(String(t.sideTokenId), "YES", t.shares);
      }

      return;
    }

    if (stepId === "netComplementary") {
      appendHedgeNote("Step 4 executed: netted complementary buys (stub).");
      return;
    }
  }

  function startHedgeTutor() {
    setHedgeTutorOpen(true);
    setHedgeStepIdx(0);
    setHedgeTyped("");
    setHedgePhase("typing");
    setHedgeNotes([]);
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
    setHedgePhase("typing");
  }

  function closeHedgePrompt() {
    setHedgeOpen(false);
  }

  function runHedgeNow() {
    // Step 2 will compute + recommend token buys here.
    // For now, just close the prompt so UX is correct.
    setHedgeOpen(false);
  }

  useEffect(() => {
    if (!hedgeTutorOpen) return;
    if (hedgePhase !== "typing") return;

    const step = HEDGE_STEPS[hedgeStepIdx];
    if (!step) return;

    let i = 0;
    const full = hedgeTextOverrideByStepId[step.id] ?? step.text;

    const timer = window.setInterval(() => {
      i += 1;
      setHedgeTyped(full.slice(0, i));
      if (i >= full.length) {
        window.clearInterval(timer);
        setHedgePhase(step.requiresAction ? "await_action" : "typing");
        if (!step.requiresAction) {
          window.setTimeout(() => {
            advanceHedgeStep();
          }, 500);
        }
      }
    }, 12);

    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hedgeTutorOpen, hedgePhase, hedgeStepIdx]);

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
            <div style={{ fontWeight: 950, fontSize: 13 }}>
              Hedging Assistant
            </div>
            <button
              onClick={() => setHedgeTutorOpen(false)}
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
              fontSize: 14,
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

          {hedgePhase === "await_action" ? (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                onClick={() => {
                  const step = HEDGE_STEPS[hedgeStepIdx];
                  if (!step) return;
                  executeHedgeStep(step.id);
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
                {HEDGE_STEPS[hedgeStepIdx]?.actionLabel ?? "Execute"}
              </button>
            </div>
          ) : null}

          {hedgePhase === "done" ? (
            <div style={{ fontSize: 14, fontWeight: 900, opacity: 0.85 }}>
              Done.
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
