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
    next.matchesById[matchId] = { ...next.matchesById[matchId], market };
    setBracket(next);
  }

  function setMatchWinner(matchId: Id, winnerId: Id | undefined) {
    const next = clone(bracket);
    next.matchesById[matchId] = { ...next.matchesById[matchId], winnerId };
    setBracket(next);
  }

  const tokenIdsNeeded = useMemo(() => {
    const ids: string[] = [];
    for (const matchId of Object.keys(bracket.matchesById)) {
      const m = bracket.matchesById[matchId];
      const toks = m.market?.clobTokenIds;
      if (Array.isArray(toks) && toks.length >= 2) {
        if (toks[0]) ids.push(String(toks[0]));
        if (toks[1]) ids.push(String(toks[1]));
      }
    }
    // unique
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
                          setMatchWinner(
                            matchId,
                            m.winnerId === teamA.id ? undefined : teamA.id,
                          );
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
                          setMatchWinner(
                            matchId,
                            m.winnerId === teamB.id ? undefined : teamB.id,
                          );
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
                                setMatchWinner(
                                  matchId,
                                  isWinner ? undefined : t.id,
                                )
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
                                  : ""}
                              </span>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}

                  {/* Market attach/search */}
                  <MatchMarketSearch
                    value={m.market}
                    onChange={(mk) => setMatchMarket(matchId, mk)}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
