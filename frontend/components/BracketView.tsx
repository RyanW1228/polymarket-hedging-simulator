// frontend/components/BracketView.tsx

"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { BracketState, Id, MarketRef } from "../bracket/types";
import { MatchMarketSearch } from "./MatchMarketSearch";
import { getActiveTeamIdsForMatch } from "../bracket/active";

type Props = {
  bracket: BracketState;
  setBracket: (next: BracketState) => void;
};

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

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* Top row above rounds */}
      <div>
        <button
          onClick={refreshOdds}
          style={{
            fontSize: 12,
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
                          fontSize: 12,
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
                          padding: "10px 12px",
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
                          padding: "10px 12px",
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
                          tryToggleWinnerWithConfirm(matchId, teamA.id);
                        }}
                        style={{
                          padding: "10px 12px",
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
                        <span>{teamA?.name ?? "—"}</span>
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
                          tryToggleWinnerWithConfirm(matchId, teamB.id);
                        }}
                        style={{
                          padding: "10px 12px",
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
                        <span>{teamB?.name ?? "—"}</span>
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
                                tryToggleWinnerWithConfirm(matchId, t.id)
                              }
                              style={{
                                padding: "10px 12px",
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
                              <span>{t.name}</span>
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
                            fontSize: 12,
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
                      <div style={{ fontSize: 12, fontWeight: 800 }}>
                        Market
                      </div>
                      <div
                        style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}
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
    </div>
  );
}
