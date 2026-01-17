// frontend/components/CreateBracketPanel.tsx

"use client";

import React, { useMemo, useState } from "react";
import type { BracketSize } from "../bracket/types";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (size: BracketSize, teamNames: string[]) => void;
};

const SIZES: BracketSize[] = [4, 8, 16, 32, 64];

function parseTeamNames(raw: string): string[] {
  return raw
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function CreateBracketPanel({ isOpen, onClose, onCreate }: Props) {
  const [size, setSize] = useState<BracketSize>(8);
  const [rawTeams, setRawTeams] = useState<string>(
    [
      "Team A",
      "Team B",
      "Team C",
      "Team D",
      "Team E",
      "Team F",
      "Team G",
      "Team H",
    ].join("\n"),
  );

  const teamNames = useMemo(() => parseTeamNames(rawTeams), [rawTeams]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        zIndex: 50,
      }}
    >
      <div
        style={{
          width: "min(720px, 100%)",
          background: "white",
          borderRadius: 14,
          padding: 18,
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
            Create bracket
          </h2>
          <button onClick={onClose} style={{ fontSize: 14 }}>
            Close
          </button>
        </div>

        <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Bracket size</div>
            <select
              value={size}
              onChange={(e) => setSize(Number(e.target.value) as BracketSize)}
              style={{ padding: 10, borderRadius: 10 }}
            >
              {SIZES.map((s) => (
                <option key={s} value={s}>
                  {s} teams
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              Team names (one per line) — extra lines ignored
            </div>
            <textarea
              value={rawTeams}
              onChange={(e) => setRawTeams(e.target.value)}
              rows={10}
              style={{
                padding: 10,
                borderRadius: 10,
                fontFamily: "ui-monospace, SFMono-Regular",
              }}
            />
          </label>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div style={{ fontSize: 12, opacity: 0.75 }}>
              Currently detected: {teamNames.length} team name(s)
            </div>
            <button
              onClick={() => onCreate(size, teamNames)}
              style={{
                padding: "10px 14px",
                borderRadius: 12,
                background: "#111",
                color: "white",
                fontWeight: 700,
              }}
            >
              Create bracket
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
