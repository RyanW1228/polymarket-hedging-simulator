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
            <div style={{ fontWeight: 900 }}>Round {roundIdx + 1}</div>

            {matchIds.map((matchId) => {
              const m = bracket.matchesById[matchId];
              const teamA = m.teamAId
                ? bracket.teamsById[m.teamAId]
                : undefined;
              const teamB = m.teamBId
                ? bracket.teamsById[m.teamBId]
                : undefined;
              const editing = isEditing(matchId);

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

                  {/* Team A */}
                  {editing ? (
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
                  ) : (
                    <div
                      style={{
                        padding: "10px 12px",
                        borderRadius: 10,
                        color: "black",
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 10,
                      }}
                    >
                      <span>{teamA?.name ?? "—"}</span>
                      <span style={{ fontWeight: 800 }}>
                        {pctA ?? (m.market ? "—" : "")}
                      </span>
                    </div>
                  )}

                  {/* Team B */}
                  {editing ? (
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
                  ) : (
                    <div
                      style={{
                        padding: "10px 12px",
                        borderRadius: 10,
                        color: "black",
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 10,
                      }}
                    >
                      <span>{teamB?.name ?? "—"}</span>
                      <span style={{ fontWeight: 800 }}>
                        {pctB ?? (m.market ? "—" : "")}
                      </span>
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
