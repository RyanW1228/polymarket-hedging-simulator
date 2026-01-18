// frontend/components/BracketView.tsx

"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { BracketState, Id, MarketRef } from "../bracket/types";
import { MatchMarketSearch } from "./MatchMarketSearch";
import { getActiveTeamIdsForMatch } from "../bracket/active";
import { HedgeDemoPanel } from "./HedgeDemoPanel";

type Props = {
  bracket: BracketState;
  setBracket: (next: BracketState) => void;
};

const SIM_POS_STORAGE_KEY = "correl.simPosByTokenId.v1";
const USDC_STORAGE_KEY = "correl.simUsdcBalance.v1";
const DEFAULT_USDC_BALANCE = 10000;

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function fmtPct(midStr: string | null | undefined): string | null {
  if (!midStr) return null;
  const x = Number(midStr);
  if (!Number.isFinite(x)) return null;
  // Prices are 0..1 for Polymarket outcome tokens; display as %
  const pct = x * 100;
  return `${pct.toFixed(1)}%`;
}

function roundTitle(roundIdx: number, totalRounds: number): string {
  const fromEnd = totalRounds - 1 - roundIdx; // 0 = Final, 1 = Semis, ...
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semifinals";
  if (fromEnd === 2) return "Quarterfinals";

  const remaining = 2 ** (fromEnd + 1); // 3 -> 16, 4 -> 32, ...
  return `Round of ${remaining}`;
}

function defaultTeamNameFor(bracket: BracketState, teamId: Id): string {
  const ids = Object.keys(bracket.teamsById).sort();
  const idx = ids.indexOf(teamId);
  return idx >= 0 ? `Team ${idx + 1}` : "Team";
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Pick the best binary market in an EVENT for a given team name.
// We match by "team name is a substring of market title" after normalization.
function pickBestEventMarketForTeam(
  eventMarkets: Array<{
    title: string;
    clobTokenIds?: string[];
  }>,
  teamName: string,
) {
  const tn = norm(teamName);
  if (!tn) return null;

  let best: { title: string; clobTokenIds?: string[]; score: number } | null =
    null;

  for (const mk of eventMarkets) {
    const title = (mk.title ?? "").trim();
    if (!title) continue;

    const ht = norm(title);

    // Must contain full team name (normalized)
    if (!ht.includes(tn)) continue;

    // Prefer shorter titles (more "direct" markets), and prefer markets that actually have token ids.
    let score = 0;
    score += 1000;
    score -= Math.min(ht.length, 300);

    const toks = mk.clobTokenIds;
    if (Array.isArray(toks) && toks.length >= 2) score += 200;

    if (!best || score > best.score) {
      best = { title, clobTokenIds: mk.clobTokenIds, score };
    }
  }

  return best;
}

export function BracketView({ bracket, setBracket }: Props) {
  const [editingMatchIds, setEditingMatchIds] = useState<Record<Id, boolean>>(
    {},
  );

  // tokenId -> midpoint string (e.g. "0.5234")
  const [midByTokenId, setMidByTokenId] = useState<Record<string, string>>({});

  // Simulated positions:
  // tokenId -> { yesShares, noShares } (numbers for demo)
  const [simPosByTokenId, setSimPosByTokenId] = useState<
    Record<string, { yes: number; no: number }>
  >({});

  // Popup state (what did the user click?)
  const [tradeModal, setTradeModal] = useState<null | {
    matchId: Id;
    teamId: Id;
    teamName: string;
    kind: "event" | "market";
    yesTokenId: string | null; // token to buy YES on (always exists for market kind)
    noTokenId: string | null; // only relevant for event kind
  }>(null);

  const [tradeSharesStr, setTradeSharesStr] = useState<string>("1");
  const [mergeSharesStr, setMergeSharesStr] = useState<string>("");
  const [convertSharesStr, setConvertSharesStr] = useState<string>("");

  const [usdcBalance, setUsdcBalance] = useState<number>(DEFAULT_USDC_BALANCE);

  const [hedgeDemoOpen, setHedgeDemoOpen] = useState(false);

  // Load USDC balance
  useEffect(() => {
    try {
      const raw = localStorage.getItem(USDC_STORAGE_KEY);
      if (!raw) return;
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0) setUsdcBalance(n);
    } catch {
      // ignore
    }
  }, []);

  // Persist USDC balance
  useEffect(() => {
    try {
      localStorage.setItem(USDC_STORAGE_KEY, String(usdcBalance));
    } catch {
      // ignore
    }
  }, [usdcBalance]);

  // Load simulated positions on refresh
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SIM_POS_STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as Record<
        string,
        { yes: number; no: number }
      >;
      if (!parsed || typeof parsed !== "object") return;

      // Basic shape guard
      const cleaned: Record<string, { yes: number; no: number }> = {};
      for (const [tokenId, v] of Object.entries(parsed)) {
        const yes = Number((v as any)?.yes ?? 0);
        const no = Number((v as any)?.no ?? 0);
        if (!Number.isFinite(yes) || !Number.isFinite(no)) continue;
        if (yes === 0 && no === 0) continue;
        cleaned[String(tokenId)] = { yes, no };
      }

      setSimPosByTokenId(cleaned);
    } catch {
      // ignore corrupted storage
    }
  }, []);

  // Persist simulated positions
  useEffect(() => {
    try {
      localStorage.setItem(
        SIM_POS_STORAGE_KEY,
        JSON.stringify(simPosByTokenId),
      );
    } catch {
      // ignore quota / private mode failures
    }
  }, [simPosByTokenId]);

  function refreshOdds() {
    // Drop cached mids so the fetch effect refetches all needed tokenIds
    setMidByTokenId({});
  }

  function toggleEdit(matchId: Id) {
    setEditingMatchIds((prev) => ({ ...prev, [matchId]: !prev[matchId] }));
  }

  function isEditing(matchId: Id) {
    return Boolean(editingMatchIds[matchId]);
  }

  function setTeamName(teamId: Id, name: string) {
    const next = clone(bracket);
    next.teamsById[teamId] = { ...next.teamsById[teamId], name };
    setBracket(next);
  }

  function setMatchMarket(matchId: Id, market: MarketRef | undefined) {
    const next = clone(bracket);

    const prev = next.matchesById[matchId];
    if (!prev) return;

    // Normalize: a match can have EITHER a market OR an event (never both in one MarketRef)
    const normalized = market
      ? market.event
        ? ({
            ...market,
            clobTokenIds: undefined,
            outcomes: undefined,
          } as MarketRef) // keep event only
        : ({ ...market, event: undefined } as MarketRef) // keep market only
      : undefined;

    const aId = prev.teamAId;
    const bId = prev.teamBId;

    // Always attach the market, and reset any previous per-team token mapping
    next.matchesById[matchId] = {
      ...prev,
      market: normalized,
      outcomeTokenIdByTeamId: undefined, // also prevents sticky old mappings
    };

    // If cleared, also clear mapping + reset Round 1 team names to defaults
    if (!normalized) {
      next.matchesById[matchId].outcomeTokenIdByTeamId = undefined;

      if (prev.round === 1) {
        if (aId && next.teamsById[aId]) {
          next.teamsById[aId] = {
            ...next.teamsById[aId],
            name: defaultTeamNameFor(next, aId),
          };
        }
        if (bId && next.teamsById[bId]) {
          next.teamsById[bId] = {
            ...next.teamsById[bId],
            name: defaultTeamNameFor(next, bId),
          };
        }
      }

      setBracket(next);
      return;
    }

    // Only Round 1 "mints" team display names from market outcomes.
    if (prev.round === 1) {
      const outs = Array.isArray(normalized?.outcomes)
        ? normalized.outcomes
        : [];

      // We only auto-name when we have at least 2 outcomes and both team slots exist.
      if (aId && bId && outs.length >= 2) {
        // Optional robustness: order outcomes to match clobTokenIds if possible
        let outA = outs[0];
        let outB = outs[1];

        if (
          Array.isArray(normalized.clobTokenIds) &&
          normalized.clobTokenIds.length >= 2
        ) {
          const t0 = normalized.clobTokenIds[0];
          const t1 = normalized.clobTokenIds[1];
          const found0 = outs.find((o) => o.tokenId === t0);
          const found1 = outs.find((o) => o.tokenId === t1);
          if (found0) outA = found0;
          if (found1) outB = found1;
        }

        // Save tokenId mapping for this match (teamId -> tokenId)
        next.matchesById[matchId].outcomeTokenIdByTeamId = {
          [aId]: outA.tokenId,
          [bId]: outB.tokenId,
        };

        // IMPORTANT: names MUST follow the currently attached market
        const teamA = next.teamsById[aId];
        const teamB = next.teamsById[bId];

        if (teamA) next.teamsById[aId] = { ...teamA, name: outA.name };
        if (teamB) next.teamsById[bId] = { ...teamB, name: outB.name };
      }
    }

    // EVENT attachment (Final/Semis futures):
    // map each active team in this match -> YES tokenId from the matching binary market title.
    if (normalized?.event && Array.isArray(normalized.event.markets)) {
      const activeIds = getActiveTeamIdsForMatch(next, matchId);
      const mapping: Record<Id, string> = {};

      for (const tid of activeIds) {
        const team = next.teamsById[tid];
        if (!team?.name) continue;

        const best = pickBestEventMarketForTeam(
          normalized.event.markets,
          team.name,
        );
        const yesTokenId = best?.clobTokenIds?.[0]; // assume [YES, NO]
        if (yesTokenId) mapping[tid] = String(yesTokenId);
      }

      next.matchesById[matchId].outcomeTokenIdByTeamId =
        Object.keys(mapping).length > 0 ? mapping : undefined;
    }

    setBracket(next);
  }

  function setMatchWinner(matchId: Id, winnerId: Id | undefined) {
    const next = clone(bracket);
    next.matchesById[matchId] = { ...next.matchesById[matchId], winnerId };
    setBracket(next);
  }

  function canMarkWinnerNow(matchId: Id): boolean {
    const m = bracket.matchesById[matchId];
    if (!m) return false;

    // Round 1 has no prerequisite child matches.
    if (m.round === 1) return true;

    // For later rounds, only allow marking a winner once BOTH participants
    // are actually determined (i.e., feeder/child matches are resolved).
    //
    // In this UI, "determined" corresponds to having 2 active teams available.
    const activeIds = getActiveTeamIdsForMatch(bracket, matchId);
    return activeIds.length === 2;
  }

  function tryToggleWinnerWithConfirm(matchId: Id, teamId: Id) {
    const m = bracket.matchesById[matchId];
    if (!m) return;

    const isWinner = m.winnerId === teamId;

    // If user is un-setting the winner, allow without confirm.
    if (isWinner) {
      setMatchWinner(matchId, undefined);
      return;
    }

    // If user is setting winner (=> 100%), enforce prerequisite rule first.
    if (!canMarkWinnerNow(matchId)) {
      window.alert(
        "You can’t mark a winner for this match yet. Resolve the feeder matches (the earlier round games) first.",
      );
      return;
    }

    // Confirm before setting an outcome to 100%.
    const ok = window.confirm(
      "Are you sure? This will mark this outcome as 100%.",
    );
    if (!ok) return;

    setMatchWinner(matchId, teamId);
  }

  function fmtShares(x: number): string {
    if (!Number.isFinite(x) || x <= 0) return "0";
    // nice display: 1, 1.5, 2.25 etc.
    const s = x.toFixed(3);
    return s.replace(/\.?0+$/, "");
  }

  function parseSharesOrNull(s: string): number | null {
    const x = Number(String(s).trim());
    if (!Number.isFinite(x) || x <= 0) return null;
    return x;
  }

  function computeCostUsd(
    midStr: string | null | undefined,
    side: "YES" | "NO",
    shares: number,
  ): number | null {
    if (!midStr) return null;
    const p = Number(midStr);
    if (!Number.isFinite(p)) return null;

    const price = side === "YES" ? p : 1 - p;
    return price * shares;
  }

  function addSimPosition(tokenId: string, side: "YES" | "NO", shares: number) {
    setSimPosByTokenId((prev) => {
      const cur = prev[tokenId] ?? { yes: 0, no: 0 };
      const next =
        side === "YES"
          ? { yes: cur.yes + shares, no: cur.no }
          : { yes: cur.yes, no: cur.no + shares };
      return { ...prev, [tokenId]: next };
    });
  }

  function cleanSimPos(
    obj: Record<string, { yes: number; no: number }>,
  ): Record<string, { yes: number; no: number }> {
    const out: Record<string, { yes: number; no: number }> = {};
    for (const [k, v] of Object.entries(obj)) {
      const yes = Number((v as any)?.yes ?? 0);
      const no = Number((v as any)?.no ?? 0);
      if (!Number.isFinite(yes) || !Number.isFinite(no)) continue;
      if (yes <= 0 && no <= 0) continue;
      out[String(k)] = { yes: Math.max(0, yes), no: Math.max(0, no) };
    }
    return out;
  }

  function mergeEventPair(yesTid: string, noTid: string, shares: number) {
    if (shares <= 0) return;

    // Return $1 per merged share (complete set)
    setUsdcBalance((b) => b + shares);

    setSimPosByTokenId((prev) => {
      const next = { ...prev };

      const y = next[yesTid] ?? { yes: 0, no: 0 };
      const n = next[noTid] ?? { yes: 0, no: 0 };

      next[yesTid] = { ...y, yes: Math.max(0, (y.yes ?? 0) - shares) };
      next[noTid] = { ...n, no: Math.max(0, (n.no ?? 0) - shares) };

      return cleanSimPos(next);
    });
  }

  function mergeMatchPair(tokA: string, tokB: string, shares: number) {
    if (shares <= 0) return;

    // Return $1 per merged share (complete set)
    setUsdcBalance((b) => b + shares);

    setSimPosByTokenId((prev) => {
      const next = { ...prev };

      const a = next[tokA] ?? { yes: 0, no: 0 };
      const b = next[tokB] ?? { yes: 0, no: 0 };

      next[tokA] = { ...a, yes: Math.max(0, (a.yes ?? 0) - shares) };
      next[tokB] = { ...b, yes: Math.max(0, (b.yes ?? 0) - shares) };

      return cleanSimPos(next);
    });
  }

  function previewMergeAllPossible(): { usdcBack: number; lines: string[] } {
    const lines: string[] = [];
    let usdcBack = 0;

    // local snapshot (NO mutation)
    const cur = simPosByTokenId;
    const next: Record<string, { yes: number; no: number }> = clone(cur);

    // ---- 1) Match markets: YES(teamA) + YES(teamB)
    for (const matchId of Object.keys(bracket.matchesById)) {
      const m = bracket.matchesById[matchId];
      const toks = m.market?.clobTokenIds;

      if (!Array.isArray(toks) || toks.length < 2) continue;

      const t0 = String(toks[0]);
      const t1 = String(toks[1]);

      const y0 = next[t0]?.yes ?? 0;
      const y1 = next[t1]?.yes ?? 0;

      const amt = Math.min(y0, y1);
      if (amt <= 0) continue;

      next[t0] = { ...(next[t0] ?? { yes: 0, no: 0 }), yes: y0 - amt };
      next[t1] = { ...(next[t1] ?? { yes: 0, no: 0 }), yes: y1 - amt };

      usdcBack += amt;

      const label =
        m.market?.title ??
        m.market?.event?.title ??
        `Match ${matchId.slice(0, 6)}`;
      lines.push(
        `Will merge ${fmtShares(amt)} complete sets (match): ${label}`,
      );
    }

    // ---- 2) Event markets: YES(yesTid) + NO(noTid)
    for (const matchId of Object.keys(bracket.matchesById)) {
      const m = bracket.matchesById[matchId];
      const ems = m.market?.event?.markets;
      if (!Array.isArray(ems)) continue;

      for (const em of ems) {
        const yesTidRaw = em?.clobTokenIds?.[0];
        const noTidRaw = em?.clobTokenIds?.[1];
        if (!yesTidRaw || !noTidRaw) continue;

        const yesTid = String(yesTidRaw);
        const noTid = String(noTidRaw);

        const y = next[yesTid]?.yes ?? 0;
        const n = next[noTid]?.no ?? 0;

        const amt = Math.min(y, n);
        if (amt <= 0) continue;

        next[yesTid] = { ...(next[yesTid] ?? { yes: 0, no: 0 }), yes: y - amt };
        next[noTid] = { ...(next[noTid] ?? { yes: 0, no: 0 }), no: n - amt };

        usdcBack += amt;

        const label =
          em?.title ?? m.market?.event?.title ?? `Event ${matchId.slice(0, 6)}`;
        lines.push(
          `Will merge ${fmtShares(amt)} complete sets (event): ${label}`,
        );
      }
    }

    return { usdcBack, lines };
  }

  // Merge EVERYTHING possible (used by Hedge Step 1)
  function mergeAllPossible(): { usdcBack: number; lines: string[] } {
    const lines: string[] = [];
    let usdcBack = 0;

    // Work off a local snapshot so we compute merges consistently once
    const cur = simPosByTokenId;
    const next: Record<string, { yes: number; no: number }> = clone(cur);

    // ---- 1) Match markets: YES(teamA) + YES(teamB)
    for (const matchId of Object.keys(bracket.matchesById)) {
      const m = bracket.matchesById[matchId];
      const toks = m.market?.clobTokenIds;

      if (!Array.isArray(toks) || toks.length < 2) continue;

      const t0 = String(toks[0]);
      const t1 = String(toks[1]);

      const y0 = next[t0]?.yes ?? 0;
      const y1 = next[t1]?.yes ?? 0;

      const amt = Math.min(y0, y1);
      if (amt <= 0) continue;

      next[t0] = { ...(next[t0] ?? { yes: 0, no: 0 }), yes: y0 - amt };
      next[t1] = { ...(next[t1] ?? { yes: 0, no: 0 }), yes: y1 - amt };

      usdcBack += amt;

      const label =
        m.market?.title ??
        m.market?.event?.title ??
        `Match ${matchId.slice(0, 6)}`;
      lines.push(`Merged ${fmtShares(amt)} complete sets (match): ${label}`);
    }

    // ---- 2) Event markets: YES(yesTid) + NO(noTid)
    for (const matchId of Object.keys(bracket.matchesById)) {
      const m = bracket.matchesById[matchId];
      const ems = m.market?.event?.markets;
      if (!Array.isArray(ems)) continue;

      for (const em of ems) {
        const yesTidRaw = em?.clobTokenIds?.[0];
        const noTidRaw = em?.clobTokenIds?.[1];
        if (!yesTidRaw || !noTidRaw) continue;

        const yesTid = String(yesTidRaw);
        const noTid = String(noTidRaw);

        const y = next[yesTid]?.yes ?? 0;
        const n = next[noTid]?.no ?? 0;

        const amt = Math.min(y, n);
        if (amt <= 0) continue;

        next[yesTid] = { ...(next[yesTid] ?? { yes: 0, no: 0 }), yes: y - amt };
        next[noTid] = { ...(next[noTid] ?? { yes: 0, no: 0 }), no: n - amt };

        usdcBack += amt;

        const label =
          em?.title ?? m.market?.event?.title ?? `Event ${matchId.slice(0, 6)}`;
        lines.push(`Merged ${fmtShares(amt)} complete sets (event): ${label}`);
      }
    }

    // Commit position changes + USDC
    const cleaned = cleanSimPos(next);
    setSimPosByTokenId(cleaned);

    if (usdcBack > 0) {
      setUsdcBalance((b) => b + usdcBack);
    }

    return { usdcBack, lines };
  }

  function convertEventNoToYesOthers(
    eventMarkets: Array<{ title: string; clobTokenIds?: string[] }>,
    noTokenId: string,
    shares: number,
  ): { ok: boolean; reason?: string } {
    if (shares <= 0) return { ok: false, reason: "Shares must be positive." };

    // Identify the "self" market by matching its NO token id at clobTokenIds[1]
    const self = eventMarkets.find(
      (mk) => String(mk?.clobTokenIds?.[1] ?? "") === String(noTokenId),
    );
    if (!self) return { ok: false, reason: "Could not locate this NO market." };

    // All other YES tokenIds in the same event (exclude self), deduped so we don't double-add
    const otherYesTokenIds = Array.from(
      new Set(
        eventMarkets
          .filter((mk) => mk !== self)
          .map((mk) => mk?.clobTokenIds?.[0])
          .filter((x): x is string => Boolean(x))
          .map(String),
      ),
    );

    if (otherYesTokenIds.length === 0) {
      return { ok: false, reason: "No other markets to convert into." };
    }

    // Convert `shares` NO on this market into +`shares` YES on EACH other market (demonstration rule)
    setSimPosByTokenId((prev) => {
      const next = { ...prev };

      // Subtract NO
      const curNo = next[noTokenId] ?? { yes: 0, no: 0 };
      next[noTokenId] = {
        ...curNo,
        no: Math.max(0, (curNo.no ?? 0) - shares),
      };

      // Add YES to each other market
      for (const yesTid of otherYesTokenIds) {
        const curYes = next[yesTid] ?? { yes: 0, no: 0 };
        next[yesTid] = {
          ...curYes,
          yes: (curYes.yes ?? 0) + shares,
        };
      }

      return cleanSimPos(next);
    });

    return { ok: true };
  }

  function previewNormalizeAllEventNoToYes(): {
    converted: number;
    lines: string[];
  } {
    const lines: string[] = [];
    let converted = 0;

    // local snapshot (NO mutation)
    const next: Record<string, { yes: number; no: number }> =
      clone(simPosByTokenId);

    for (const matchId of Object.keys(bracket.matchesById)) {
      const m = bracket.matchesById[matchId];
      const ems = m.market?.event?.markets;
      if (!Array.isArray(ems) || ems.length < 2) continue;

      for (const mk of ems) {
        const noTidRaw = mk?.clobTokenIds?.[1];
        if (!noTidRaw) continue;
        const noTid = String(noTidRaw);

        const heldNo = next[noTid]?.no ?? 0;
        if (heldNo <= 0) continue;

        // find the "self" market (the one whose NO token is noTid)
        const self = ems.find(
          (x) => String(x?.clobTokenIds?.[1] ?? "") === String(noTid),
        );
        if (!self) continue;

        const otherYesTokenIds = Array.from(
          new Set(
            ems
              .filter((x) => x !== self)
              .map((x) => x?.clobTokenIds?.[0])
              .filter((x): x is string => Boolean(x))
              .map(String),
          ),
        );

        if (otherYesTokenIds.length === 0) continue;

        // simulate: subtract NO
        const curNo = next[noTid] ?? { yes: 0, no: 0 };
        next[noTid] = { ...curNo, no: Math.max(0, (curNo.no ?? 0) - heldNo) };

        // simulate: add YES to each other market (same rule as your real convert fn)
        for (const yesTid of otherYesTokenIds) {
          const curYes = next[yesTid] ?? { yes: 0, no: 0 };
          next[yesTid] = { ...curYes, yes: (curYes.yes ?? 0) + heldNo };
        }

        converted += heldNo;

        const label =
          mk?.title ?? m.market?.event?.title ?? `Event ${matchId.slice(0, 6)}`;
        lines.push(
          `Will convert ${fmtShares(heldNo)} NO → YES on ${otherYesTokenIds.length} other markets (event): ${label}`,
        );
      }
    }

    return { converted, lines };
  }

  // Step 2 helper: normalize ALL event NO positions -> YES of other event markets
  function normalizeAllEventNoToYes(): { converted: number } {
    let converted = 0;

    for (const matchId of Object.keys(bracket.matchesById)) {
      const m = bracket.matchesById[matchId];
      const ems = m.market?.event?.markets;
      if (!Array.isArray(ems) || ems.length < 2) continue;

      // For each event market, if user holds NO on its NO token, convert it
      for (const mk of ems) {
        const noTidRaw = mk?.clobTokenIds?.[1];
        if (!noTidRaw) continue;
        const noTid = String(noTidRaw);

        const heldNo = simPosByTokenId[noTid]?.no ?? 0;
        if (heldNo <= 0) continue;

        const res = convertEventNoToYesOthers(ems, noTid, heldNo);
        if (res.ok) converted += heldNo;
      }
    }

    return { converted };
  }

  function openTradeModalForTeam(matchId: Id, teamId: Id) {
    const m = bracket.matchesById[matchId];
    const team = bracket.teamsById[teamId];
    if (!m || !team) return;

    // 1) EVENT market case: we want BOTH YES and NO tokenIds from the matched binary market
    if (m.market?.event && Array.isArray(m.market.event.markets)) {
      const best = pickBestEventMarketForTeam(
        m.market.event.markets,
        team.name,
      );
      const yesTid = best?.clobTokenIds?.[0]
        ? String(best.clobTokenIds[0])
        : null;
      const noTid = best?.clobTokenIds?.[1]
        ? String(best.clobTokenIds[1])
        : null;

      setTradeSharesStr("1");
      // Default merge amount = max mergeable
      if (yesTid && noTid) {
        const y = simPosByTokenId[yesTid]?.yes ?? 0;
        const n = simPosByTokenId[noTid]?.no ?? 0;
        const maxMerge = Math.min(y, n);
        setMergeSharesStr(maxMerge > 0 ? String(maxMerge) : "");
      } else {
        setMergeSharesStr("");
      }

      // Default convert amount = max NO held on this team’s event market
      if (noTid) {
        const heldNo = simPosByTokenId[noTid]?.no ?? 0;
        setConvertSharesStr(heldNo > 0 ? String(heldNo) : "");
      } else {
        setConvertSharesStr("");
      }

      setTradeModal({
        matchId,
        teamId,
        teamName: team.name,
        kind: "event",
        yesTokenId: yesTid,
        noTokenId: noTid,
      });
      return;
    }

    // 2) Normal attached market case: each team corresponds to its own outcome tokenId.
    // Prefer the per-team mapping if present (Round 1 sets it).
    const mappedTok = m.outcomeTokenIdByTeamId?.[teamId];
    const yesTok = mappedTok ? String(mappedTok) : null;

    // Default merge amount = max mergeable across both teams in this match
    const toks = m.market?.clobTokenIds;
    const otherTeamId = teamId === m.teamAId ? m.teamBId : m.teamAId;

    const otherTokRaw =
      (otherTeamId ? m.outcomeTokenIdByTeamId?.[otherTeamId] : undefined) ??
      (Array.isArray(toks) && toks.length >= 2
        ? String(teamId === m.teamAId ? toks[1] : toks[0])
        : null);

    const thisTok = yesTok;
    const otherTok = otherTokRaw ? String(otherTokRaw) : null;

    if (thisTok && otherTok) {
      const a = simPosByTokenId[thisTok]?.yes ?? 0;
      const b = simPosByTokenId[otherTok]?.yes ?? 0;
      const maxMerge = Math.min(a, b);
      setMergeSharesStr(maxMerge > 0 ? String(maxMerge) : "");
    } else {
      setMergeSharesStr("");
    }

    setTradeSharesStr("1");
    setTradeModal({
      matchId,
      teamId,
      teamName: team.name,
      kind: "market",
      yesTokenId: yesTok,
      noTokenId: null,
    });
  }

  function closeTradeModal() {
    setTradeModal(null);
  }

  type EventMarket = { title: string; clobTokenIds?: string[] };

  function getMid(tokenId: string | null | undefined): number | null {
    if (!tokenId) return null;
    const s = midByTokenId[String(tokenId)];
    if (!s) return null;
    const x = Number(s);
    return Number.isFinite(x) ? x : null;
  }

  const tokenIdsNeeded = useMemo(() => {
    const ids: string[] = [];
    for (const matchId of Object.keys(bracket.matchesById)) {
      const m = bracket.matchesById[matchId];
      const hasAttachment = Boolean(m.market);

      // 1) Normal attached market token ids
      const toks = m.market?.clobTokenIds;
      if (Array.isArray(toks) && toks.length >= 2) {
        if (toks[0]) ids.push(String(toks[0]));
        if (toks[1]) ids.push(String(toks[1]));
      }

      // 2) Per-team mapping token ids (used for EVENT futures)
      const map = m.outcomeTokenIdByTeamId;
      if (map && typeof map === "object") {
        for (const tok of Object.values(map)) {
          if (tok) ids.push(String(tok));
        }
      }
    }
    return Array.from(new Set(ids));
  }, [bracket]);

  useEffect(() => {
    let cancelled = false;

    async function fetchMissing() {
      const missing = tokenIdsNeeded.filter((t) => !(t in midByTokenId));
      if (missing.length === 0) return;

      // Fetch in small batches to avoid spamming
      const batch = missing.slice(0, 10);

      const results = await Promise.all(
        batch.map(async (tokenId) => {
          try {
            const res = await fetch(
              `/api/polymarket/midpoint?token_id=${encodeURIComponent(tokenId)}`,
            );
            const data = (await res.json()) as {
              tokenId?: string;
              mid?: string | null;
              error?: string;
            };
            if (data.error) return null;
            if (!data.tokenId || !data.mid) return null;
            return { tokenId: data.tokenId, mid: data.mid };
          } catch {
            return null;
          }
        }),
      );

      if (cancelled) return;

      const updates: Record<string, string> = {};
      for (const r of results) {
        if (r?.tokenId && r.mid) updates[r.tokenId] = r.mid;
      }

      if (Object.keys(updates).length > 0) {
        setMidByTokenId((prev) => ({ ...prev, ...updates }));
      }
    }

    fetchMissing();

    return () => {
      cancelled = true;
    };
  }, [tokenIdsNeeded, midByTokenId]);

  const round1MatchIds = bracket.roundMatchIds[0] ?? [];
  const round1Ready =
    round1MatchIds.length > 0 &&
    round1MatchIds.every((id) => Boolean(bracket.matchesById[id]?.market));

  const marketsLockedForLaterRounds = !round1Ready;

  // "Main game markets" = normal match markets (NOT event markets).
  // If the user holds NO non-main tokens, hedging is unnecessary for demo purposes.
  const hasNonMainGameTokens = useMemo(() => {
    // Collect all tokenIds that belong to main match markets
    const mainTokenIds = new Set<string>();

    for (const matchId of Object.keys(bracket.matchesById)) {
      const m = bracket.matchesById[matchId];
      if (!m.market) continue;
      if (m.market.event) continue; // event markets are NOT main game markets

      const toks = m.market.clobTokenIds;
      if (Array.isArray(toks)) {
        for (const t of toks) {
          if (t) mainTokenIds.add(String(t));
        }
      }
    }

    // If user holds any tokenId that's NOT in mainTokenIds, that is a non-main token
    for (const [tokenId, pos] of Object.entries(simPosByTokenId)) {
      const yes = Number(pos?.yes ?? 0);
      const no = Number(pos?.no ?? 0);
      if (yes <= 0 && no <= 0) continue;

      if (!mainTokenIds.has(String(tokenId))) return true;
    }

    return false;
  }, [bracket, simPosByTokenId]);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* Top row above rounds + USDC balance (same width as buttons row) */}
      <div style={{ width: "fit-content", display: "grid", gap: 12 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            onClick={refreshOdds}
            style={{
              fontSize: 14,
              padding: "6px 10px",
              borderRadius: 10,
              border: "1px solid #ddd",
              background: "white",
              cursor: "pointer",
              fontWeight: 800,
            }}
          >
            Refresh Odds
          </button>

          <button
            onClick={() => {
              setHedgeDemoOpen(true);
              window.dispatchEvent(new Event("correl:open-hedge-demo"));
            }}
            style={{
              fontSize: 14,
              padding: "6px 10px",
              borderRadius: 10,
              border: "1px solid #ddd",
              background: "white",
              cursor: "pointer",
              fontWeight: 800,
            }}
          >
            Hedge Positions
          </button>

          <button
            onClick={() => {
              // Clear simulated positions + reset USDC to 10000
              setSimPosByTokenId({});
              setUsdcBalance(DEFAULT_USDC_BALANCE);
              try {
                localStorage.setItem(SIM_POS_STORAGE_KEY, JSON.stringify({}));
                localStorage.setItem(
                  USDC_STORAGE_KEY,
                  String(DEFAULT_USDC_BALANCE),
                );
              } catch {
                // ignore
              }
            }}
            style={{
              fontSize: 14,
              padding: "6px 10px",
              borderRadius: 10,
              border: "1px solid #ddd",
              background: "white",
              cursor: "pointer",
              fontWeight: 800,
            }}
          >
            Clear Positions
          </button>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            border: "1px solid #eee",
            background: "white",
            borderRadius: 12,
            padding: "10px 12px",
            maxWidth: 260,
            width: "100%",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 900, opacity: 0.8 }}>
            USDC Balance
          </div>
          <div style={{ fontSize: 14, fontWeight: 950 }}>
            $
            {usdcBalance.toLocaleString(undefined, {
              maximumFractionDigits: 2,
            })}
          </div>
        </div>
      </div>

      {/* Rounds row */}
      <div
        style={{
          display: "flex",
          gap: 16,
          alignItems: "flex-start",
          overflowX: "auto",
          paddingBottom: 8,
        }}
      >
        {bracket.roundMatchIds.map((matchIds, roundIdx) => (
          <div
            key={roundIdx}
            style={{ minWidth: 260, display: "grid", gap: 12 }}
          >
            <div style={{ fontWeight: 900 }}>
              {roundTitle(roundIdx, bracket.roundMatchIds.length)}
            </div>

            {matchIds.map((matchId) => {
              const m = bracket.matchesById[matchId];
              const hasAttachment = Boolean(m.market);
              const teamA = m.teamAId
                ? bracket.teamsById[m.teamAId]
                : undefined;
              const teamB = m.teamBId
                ? bracket.teamsById[m.teamBId]
                : undefined;
              const editing = isEditing(matchId);
              const activeTeamIds = getActiveTeamIdsForMatch(bracket, matchId);
              const activeTeams = activeTeamIds
                .map((tid) => bracket.teamsById[tid])
                .filter(Boolean);

              const tokA = Array.isArray(m.market?.clobTokenIds)
                ? m.market?.clobTokenIds?.[0]
                : undefined;
              const tokB = Array.isArray(m.market?.clobTokenIds)
                ? m.market?.clobTokenIds?.[1]
                : undefined;

              const pctA = tokA ? fmtPct(midByTokenId[String(tokA)]) : null;
              const pctB = tokB ? fmtPct(midByTokenId[String(tokB)]) : null;

              return (
                <div
                  key={matchId}
                  style={{
                    border: "1px solid #ddd",
                    borderRadius: 12,
                    padding: 12,
                    display: "grid",
                    gap: 10,
                    background: "white",
                  }}
                >
                  {m.round === 1 ? (
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "flex-end",
                        gap: 8,
                      }}
                    >
                      <button
                        onClick={() => toggleEdit(matchId)}
                        style={{
                          fontSize: 14,
                          padding: "4px 8px",
                          borderRadius: 10,
                          border: "1px solid #ddd",
                          background: "white",
                          cursor: "pointer",
                        }}
                      >
                        {editing ? "Done" : "Edit"}
                      </button>
                    </div>
                  ) : null}

                  {/* Teams */}
                  {editing ? (
                    <>
                      {/* Team A input */}
                      <input
                        value={teamA?.name ?? ""}
                        onChange={(e) => {
                          if (!teamA) return;
                          setTeamName(teamA.id, e.target.value);
                        }}
                        placeholder={teamA ? "Team name" : "—"}
                        disabled={!teamA}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 10,
                          border: "1px solid #ccc",
                          background: !teamA ? "#f7f7f7" : "white",
                          color: "black",
                        }}
                      />

                      {/* Team B input */}
                      <input
                        value={teamB?.name ?? ""}
                        onChange={(e) => {
                          if (!teamB) return;
                          setTeamName(teamB.id, e.target.value);
                        }}
                        placeholder={teamB ? "Team name" : "—"}
                        disabled={!teamB}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 10,
                          border: "1px solid #ccc",
                          background: !teamB ? "#f7f7f7" : "white",
                          color: "black",
                        }}
                      />
                    </>
                  ) : m.round === 1 ? (
                    <>
                      {/* Round 1: clickable rows (pick winner) */}
                      <div
                        onClick={() => {
                          if (!teamA) return;
                          openTradeModalForTeam(matchId, teamA.id);
                        }}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 10,
                          color: "black",
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 10,
                          cursor: teamA ? "pointer" : "default",
                          border:
                            m.winnerId === teamA?.id
                              ? "2px solid #111"
                              : "1px solid transparent",
                          opacity:
                            m.winnerId && m.winnerId !== teamA?.id ? 0.35 : 1,
                          userSelect: "none",
                        }}
                      >
                        <div style={{ display: "grid", gap: 6 }}>
                          <div>{teamA?.name ?? "—"}</div>
                          {(() => {
                            const tok =
                              m.outcomeTokenIdByTeamId?.[teamA?.id ?? ""];
                            const tid = tok ? String(tok) : null;
                            if (!tid) return null;

                            const pos = simPosByTokenId[tid];
                            const yes = pos?.yes ?? 0;
                            if (yes <= 0) return null;

                            return (
                              <div
                                style={{
                                  display: "flex",
                                  gap: 6,
                                  flexWrap: "wrap",
                                }}
                              >
                                <span
                                  style={{
                                    fontSize: 14,
                                    fontWeight: 900,
                                    padding: "4px 10px",
                                    borderRadius: 999,
                                    background: "#e9fbe9",
                                    border: "1px solid #c9f2c9",
                                  }}
                                >
                                  YES {fmtShares(yes)}
                                </span>
                              </div>
                            );
                          })()}
                        </div>

                        <span style={{ fontWeight: 800 }}>
                          {m.winnerId
                            ? m.winnerId === teamA?.id
                              ? "100.0%"
                              : "0.0%"
                            : (pctA ?? (m.market ? "—" : ""))}
                        </span>
                      </div>

                      <div
                        onClick={() => {
                          if (!teamB) return;
                          openTradeModalForTeam(matchId, teamB.id);
                        }}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 10,
                          color: "black",
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 10,
                          cursor: teamB ? "pointer" : "default",
                          border:
                            m.winnerId === teamB?.id
                              ? "2px solid #111"
                              : "1px solid transparent",
                          opacity:
                            m.winnerId && m.winnerId !== teamB?.id ? 0.35 : 1,
                          userSelect: "none",
                        }}
                      >
                        <div style={{ display: "grid", gap: 6 }}>
                          <div>{teamB?.name ?? "—"}</div>
                          {(() => {
                            const tok =
                              m.outcomeTokenIdByTeamId?.[teamB?.id ?? ""];
                            const tid = tok ? String(tok) : null;
                            if (!tid) return null;

                            const pos = simPosByTokenId[tid];
                            const yes = pos?.yes ?? 0;
                            if (yes <= 0) return null;

                            return (
                              <div
                                style={{
                                  display: "flex",
                                  gap: 6,
                                  flexWrap: "wrap",
                                }}
                              >
                                <span
                                  style={{
                                    fontSize: 14,
                                    fontWeight: 900,
                                    padding: "4px 10px",
                                    borderRadius: 999,
                                    background: "#e9fbe9",
                                    border: "1px solid #c9f2c9",
                                  }}
                                >
                                  YES {fmtShares(yes)}
                                </span>
                              </div>
                            );
                          })()}
                        </div>

                        <span style={{ fontWeight: 800 }}>
                          {m.winnerId
                            ? m.winnerId === teamB?.id
                              ? "100.0%"
                              : "0.0%"
                            : (pctB ?? (m.market ? "—" : ""))}
                        </span>
                      </div>
                    </>
                  ) : (
                    /* Round 2+: vertical list (like Round 1, but N rows) */
                    <div style={{ display: "grid", gap: 8 }}>
                      {activeTeams.length === 0 ? (
                        <div style={{ opacity: 0.6 }}>—</div>
                      ) : (
                        activeTeams.map((t) => {
                          const isWinner = m.winnerId === t.id;
                          const isEliminated = Boolean(
                            m.winnerId && m.winnerId !== t.id,
                          );

                          return (
                            <div
                              key={t.id}
                              onClick={() =>
                                openTradeModalForTeam(matchId, t.id)
                              }
                              style={{
                                padding: "6px 12px",
                                borderRadius: 10,
                                color: "black",
                                display: "flex",
                                justifyContent: "space-between",
                                gap: 10,
                                cursor: "pointer",
                                border: isWinner
                                  ? "2px solid #111"
                                  : "1px solid transparent",
                                opacity: isEliminated ? 0.35 : 1,
                                userSelect: "none",
                              }}
                            >
                              <div style={{ display: "grid", gap: 6 }}>
                                <div>{t.name}</div>

                                {(() => {
                                  // EVENT row: show both YES and NO pills if user bought them.
                                  if (
                                    m.market?.event &&
                                    Array.isArray(m.market.event.markets)
                                  ) {
                                    const best = pickBestEventMarketForTeam(
                                      m.market.event.markets,
                                      t.name,
                                    );
                                    const yesTid = best?.clobTokenIds?.[0]
                                      ? String(best.clobTokenIds[0])
                                      : null;
                                    const noTid = best?.clobTokenIds?.[1]
                                      ? String(best.clobTokenIds[1])
                                      : null;

                                    const yes = yesTid
                                      ? (simPosByTokenId[yesTid]?.yes ?? 0)
                                      : 0;
                                    const no = noTid
                                      ? (simPosByTokenId[noTid]?.no ?? 0)
                                      : 0;

                                    if (yes <= 0 && no <= 0) return null;

                                    return (
                                      <div
                                        style={{
                                          display: "flex",
                                          gap: 6,
                                          flexWrap: "wrap",
                                        }}
                                      >
                                        {yes > 0 ? (
                                          <span
                                            style={{
                                              fontSize: 14,
                                              fontWeight: 900,
                                              padding: "4px 10px",
                                              borderRadius: 999,
                                              background: "#e9fbe9",
                                              border: "1px solid #c9f2c9",
                                            }}
                                          >
                                            YES {fmtShares(yes)}
                                          </span>
                                        ) : null}

                                        {no > 0 ? (
                                          <span
                                            style={{
                                              fontSize: 14,
                                              fontWeight: 900,
                                              padding: "4px 10px",
                                              borderRadius: 999,
                                              background: "#ffe9e9",
                                              border: "1px solid #f2c9c9",
                                            }}
                                          >
                                            NO {fmtShares(no)}
                                          </span>
                                        ) : null}
                                      </div>
                                    );
                                  }

                                  // Non-event row: only show YES pill for that team's mapped token (if available)
                                  const tok = m.outcomeTokenIdByTeamId?.[t.id];
                                  const tid = tok ? String(tok) : null;
                                  if (!tid) return null;

                                  const pos = simPosByTokenId[tid];
                                  const yes = pos?.yes ?? 0;
                                  if (yes <= 0) return null;

                                  return (
                                    <div
                                      style={{
                                        display: "flex",
                                        gap: 6,
                                        flexWrap: "wrap",
                                      }}
                                    >
                                      <span
                                        style={{
                                          fontSize: 14,
                                          fontWeight: 900,
                                          padding: "4px 10px",
                                          borderRadius: 999,
                                          background: "#e9fbe9",
                                          border: "1px solid #c9f2c9",
                                        }}
                                      >
                                        YES {fmtShares(yes)}
                                      </span>
                                    </div>
                                  );
                                })()}
                              </div>
                              <span style={{ fontWeight: 800 }}>
                                {m.winnerId
                                  ? isWinner
                                    ? "100.0%"
                                    : "0.0%"
                                  : (() => {
                                      const tok =
                                        m.outcomeTokenIdByTeamId?.[t.id];
                                      const pct = tok
                                        ? fmtPct(midByTokenId[String(tok)])
                                        : null;
                                      return pct ?? "";
                                    })()}
                              </span>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}

                  {/* Market attach/search */}
                  {m.round === 1 || !marketsLockedForLaterRounds ? (
                    hasAttachment ? (
                      <div style={{ display: "grid", gap: 8 }}>
                        <div style={{ fontSize: 13, fontWeight: 800 }}>
                          {m.market?.event?.title ??
                            m.market?.title ??
                            "Attached market"}
                        </div>

                        <button
                          onClick={() => setMatchMarket(matchId, undefined)}
                          style={{
                            fontSize: 14,
                            padding: "6px 10px",
                            borderRadius: 10,
                            border: "1px solid #ddd",
                            background: "white",
                            cursor: "pointer",
                            fontWeight: 800,
                            width: "fit-content",
                          }}
                        >
                          Clear
                        </button>
                      </div>
                    ) : (
                      <MatchMarketSearch
                        value={m.market}
                        onChange={(mk) => setMatchMarket(matchId, mk)}
                        allowEvents={m.round !== 1}
                      />
                    )
                  ) : (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 14, fontWeight: 800 }}>
                        Market
                      </div>
                      <div
                        style={{ marginTop: 6, fontSize: 14, opacity: 0.75 }}
                      >
                        Attach markets for <b>Round of {bracket.size}</b> first
                        (Round 1) to lock team names.
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {hedgeDemoOpen ? (
        <HedgeDemoPanel
          bracket={bracket}
          simPosByTokenId={simPosByTokenId}
          addSimPosition={addSimPosition}
          midByTokenId={midByTokenId}
          usdcBalance={usdcBalance}
          setUsdcBalance={setUsdcBalance}
          getMid={getMid}
          fmtPct={fmtPct}
          fmtShares={fmtShares}
          computeCostUsd={computeCostUsd}
          norm={norm}
          mergeAllPossible={mergeAllPossible}
          normalizeAllEventNoToYes={normalizeAllEventNoToYes}
          previewMergeAllPossible={previewMergeAllPossible}
          previewNormalizeAllEventNoToYes={previewNormalizeAllEventNoToYes}
        />
      ) : null}

      {/* Trade / Resolve modal */}
      {tradeModal ? (
        <div
          onClick={closeTradeModal}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.25)",
            display: "grid",
            placeItems: "center",
            padding: 16,
            zIndex: 50,
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
                {tradeModal.teamName}
              </div>
              <button
                onClick={closeTradeModal}
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

            <div style={{ fontSize: 14, opacity: 0.8, lineHeight: 1.3 }}>
              {tradeModal.kind === "event"
                ? "Event market: you can simulate buying YES or NO on this team."
                : "Match market: simulate buying YES on this team’s outcome token."}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontSize: 14, fontWeight: 900 }}>Shares</div>
              <input
                value={tradeSharesStr}
                onChange={(e) => setTradeSharesStr(e.target.value)}
                placeholder="e.g. 1"
                style={{
                  padding: "6px 12px",
                  borderRadius: 10,
                  border: "1px solid #ccc",
                  background: "white",
                  color: "black",
                  fontSize: 14,
                }}
              />
            </div>

            {tradeModal.kind === "event"
              ? (() => {
                  const m = bracket.matchesById[tradeModal.matchId];
                  const ems = m?.market?.event?.markets;
                  if (!Array.isArray(ems)) return null;

                  const noTid = tradeModal.noTokenId;
                  if (!noTid) return null;

                  const heldNo = simPosByTokenId[noTid]?.no ?? 0;
                  if (heldNo <= 0) return null;

                  // Determine how many "other" YES markets exist to convert into
                  const otherYes = ems
                    .filter(
                      (mk) =>
                        String(mk?.clobTokenIds?.[1] ?? "") !== String(noTid),
                    )
                    .map((mk) => mk?.clobTokenIds?.[0])
                    .filter(Boolean);

                  if (otherYes.length === 0) return null;

                  return (
                    <div
                      style={{
                        borderTop: "1px solid #eee",
                        paddingTop: 10,
                        display: "grid",
                        gap: 8,
                      }}
                    >
                      <div style={{ fontSize: 14, fontWeight: 950 }}>
                        Convert NO → YES (other event markets)
                      </div>

                      <div
                        style={{
                          fontSize: 14,
                          opacity: 0.85,
                          lineHeight: 1.45,
                        }}
                      >
                        For demonstrative purposes, we convert NO shares on this
                        team into YES shares across the remaining markets in the
                        same event (equal split).
                      </div>

                      <div style={{ display: "grid", gap: 6 }}>
                        <div style={{ fontSize: 14, fontWeight: 900 }}>
                          NO shares to convert (max {fmtShares(heldNo)})
                        </div>
                        <input
                          value={convertSharesStr}
                          onChange={(e) => setConvertSharesStr(e.target.value)}
                          placeholder={String(heldNo)}
                          style={{
                            padding: "8px 12px",
                            borderRadius: 10,
                            border: "1px solid #ccc",
                            background: "white",
                            color: "black",
                            fontSize: 14,
                          }}
                        />
                      </div>

                      <button
                        onClick={() => {
                          const amt = parseSharesOrNull(convertSharesStr);
                          if (!amt) {
                            window.alert(
                              "Enter a positive number of NO shares to convert.",
                            );
                            return;
                          }
                          if (amt > heldNo + 1e-9) {
                            window.alert(
                              "That exceeds your NO shares for this market.",
                            );
                            return;
                          }

                          const res = convertEventNoToYesOthers(
                            ems,
                            noTid,
                            amt,
                          );
                          if (!res.ok) {
                            window.alert(res.reason ?? "Conversion failed.");
                            return;
                          }

                          closeTradeModal();
                        }}
                        style={{
                          fontSize: 14,
                          padding: "12px 14px",
                          borderRadius: 12,
                          border: "1px solid #ddd",
                          background: "white",
                          cursor: "pointer",
                          fontWeight: 950,
                          width: "fit-content",
                        }}
                      >
                        Convert
                      </button>
                    </div>
                  );
                })()
              : null}

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                onClick={() => {
                  const shares = parseSharesOrNull(tradeSharesStr);
                  if (!shares) {
                    window.alert("Enter a positive number of shares.");
                    return;
                  }
                  if (!tradeModal.yesTokenId) {
                    window.alert("Missing YES token id for this row.");
                    return;
                  }

                  const mid = midByTokenId[tradeModal.yesTokenId];
                  const cost = computeCostUsd(mid, "YES", shares);
                  if (cost === null) {
                    window.alert("Price unavailable.");
                    return;
                  }
                  if (usdcBalance < cost) {
                    window.alert("Insufficient USDC balance.");
                    return;
                  }

                  setUsdcBalance((b) => b - cost);
                  addSimPosition(tradeModal.yesTokenId, "YES", shares);
                  closeTradeModal();
                }}
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
                Buy YES
              </button>

              {tradeModal.kind === "event" ? (
                <button
                  onClick={() => {
                    const shares = parseSharesOrNull(tradeSharesStr);
                    if (!shares) {
                      window.alert("Enter a positive number of shares.");
                      return;
                    }
                    if (!tradeModal.noTokenId) {
                      window.alert("Missing NO token id for this event row.");
                      return;
                    }
                    if (!tradeModal.yesTokenId) {
                      window.alert("Missing YES token id for this event row.");
                      return;
                    }

                    const yesMidStr = midByTokenId[tradeModal.yesTokenId];
                    if (!yesMidStr) {
                      window.alert("Price unavailable.");
                      return;
                    }
                    const pYes = Number(yesMidStr);
                    if (!Number.isFinite(pYes)) {
                      window.alert("Price unavailable.");
                      return;
                    }

                    const cost = (1 - pYes) * shares; // NO price is 1 - YES price
                    if (usdcBalance < cost) {
                      window.alert("Insufficient USDC balance.");
                      return;
                    }

                    setUsdcBalance((b) => b - cost);
                    addSimPosition(tradeModal.noTokenId, "NO", shares);
                    closeTradeModal();
                  }}
                  style={{
                    fontSize: 14,
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid #f2c9c9",
                    background: "#ffe9e9",
                    cursor: "pointer",
                    fontWeight: 950,
                  }}
                >
                  Buy NO
                </button>
              ) : null}
              {(() => {
                // Compute mergeability for THIS popup row
                let mergeMax = 0;
                let mergeLabel: string | null = null;

                if (tradeModal.kind === "event") {
                  const yid = tradeModal.yesTokenId;
                  const nid = tradeModal.noTokenId;
                  if (yid && nid) {
                    const y = simPosByTokenId[yid]?.yes ?? 0;
                    const n = simPosByTokenId[nid]?.no ?? 0;
                    mergeMax = Math.min(y, n);
                    if (mergeMax > 0)
                      mergeLabel = "Merge YES+NO (complete sets)";
                  }
                } else {
                  const m = bracket.matchesById[tradeModal.matchId];
                  const toks = m?.market?.clobTokenIds;

                  const otherTeamId =
                    tradeModal.teamId === m?.teamAId ? m?.teamBId : m?.teamAId;

                  const otherTokRaw =
                    (otherTeamId
                      ? m?.outcomeTokenIdByTeamId?.[otherTeamId]
                      : undefined) ??
                    (Array.isArray(toks) && toks.length >= 2
                      ? String(
                          tradeModal.teamId === m?.teamAId ? toks[1] : toks[0],
                        )
                      : null);

                  const thisTok = tradeModal.yesTokenId;
                  const otherTok = otherTokRaw ? String(otherTokRaw) : null;

                  if (thisTok && otherTok) {
                    const a = simPosByTokenId[thisTok]?.yes ?? 0;
                    const b = simPosByTokenId[otherTok]?.yes ?? 0;
                    mergeMax = Math.min(a, b);
                    if (mergeMax > 0) {
                      const otherName =
                        otherTeamId && bracket.teamsById[otherTeamId]
                          ? bracket.teamsById[otherTeamId].name
                          : "other team";
                      mergeLabel = `Merge YES(this team) + YES(${otherName}) (complete sets)`;
                    }
                  }
                }

                if (mergeMax <= 0) return null;

                return (
                  <div
                    style={{
                      borderTop: "1px solid #eee",
                      paddingTop: 10,
                      display: "grid",
                      gap: 8,
                    }}
                  >
                    <div style={{ fontSize: 14, fontWeight: 950 }}>Merge</div>
                    <div
                      style={{ fontSize: 14, opacity: 0.8, lineHeight: 1.3 }}
                    >
                      {mergeLabel}. You’ll receive <b>$1 USDC</b> per merged
                      share.
                    </div>

                    <div style={{ display: "grid", gap: 6 }}>
                      <div style={{ fontSize: 14, fontWeight: 900 }}>
                        Shares to merge (max {fmtShares(mergeMax)})
                      </div>
                      <input
                        value={mergeSharesStr}
                        onChange={(e) => setMergeSharesStr(e.target.value)}
                        placeholder={String(mergeMax)}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 10,
                          border: "1px solid #ccc",
                          background: "white",
                          color: "black",
                          fontSize: 14,
                        }}
                      />
                    </div>

                    <button
                      onClick={() => {
                        const shares = parseSharesOrNull(mergeSharesStr);
                        if (!shares) {
                          window.alert(
                            "Enter a positive number of shares to merge.",
                          );
                          return;
                        }
                        if (shares > mergeMax + 1e-9) {
                          window.alert(
                            "That exceeds the max mergeable shares.",
                          );
                          return;
                        }

                        if (tradeModal.kind === "event") {
                          const yid = tradeModal.yesTokenId;
                          const nid = tradeModal.noTokenId;
                          if (!yid || !nid) {
                            window.alert("Missing token ids for merge.");
                            return;
                          }
                          mergeEventPair(yid, nid, shares);
                          closeTradeModal();
                          return;
                        }

                        // market kind
                        const m = bracket.matchesById[tradeModal.matchId];
                        const toks = m?.market?.clobTokenIds;

                        const otherTeamId =
                          tradeModal.teamId === m?.teamAId
                            ? m?.teamBId
                            : m?.teamAId;

                        const otherTokRaw =
                          (otherTeamId
                            ? m?.outcomeTokenIdByTeamId?.[otherTeamId]
                            : undefined) ??
                          (Array.isArray(toks) && toks.length >= 2
                            ? String(
                                tradeModal.teamId === m?.teamAId
                                  ? toks[1]
                                  : toks[0],
                              )
                            : null);

                        const thisTok = tradeModal.yesTokenId;
                        const otherTok = otherTokRaw
                          ? String(otherTokRaw)
                          : null;

                        if (!thisTok || !otherTok) {
                          window.alert("Missing token ids for merge.");
                          return;
                        }

                        mergeMatchPair(thisTok, otherTok, shares);
                        closeTradeModal();
                      }}
                      style={{
                        fontSize: 14,
                        padding: "10px 12px",
                        borderRadius: 12,
                        border: "1px solid #ddd",
                        background: "white",
                        cursor: "pointer",
                        fontWeight: 950,
                        width: "fit-content",
                      }}
                    >
                      Merge (get USDC back)
                    </button>
                  </div>
                );
              })()}

              {canMarkWinnerNow(tradeModal.matchId) ? (
                <button
                  onClick={() => {
                    // Resolve / set winner to 100% (uses your existing rules + confirm)
                    tryToggleWinnerWithConfirm(
                      tradeModal.matchId,
                      tradeModal.teamId,
                    );
                    closeTradeModal();
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
                  Resolve to 100%
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
