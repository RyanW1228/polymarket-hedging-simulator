// frontend/app/page.tsx

"use client";

import React, { useMemo, useState } from "react";
import { createBracket } from "../bracket/createBracket";
import type { BracketState, BracketSize } from "../bracket/types";
import { CreateBracketPanel } from "../components/CreateBracketPanel";
import { BracketView } from "../components/BracketView";

export default function Home() {
  const [panelOpen, setPanelOpen] = useState(false);
  const [bracket, setBracket] = useState<BracketState | null>(null);

  const summary = useMemo(() => {
    if (!bracket) return null;
    const rounds = bracket.roundMatchIds.length;
    const matches = Object.keys(bracket.matchesById).length;
    return { rounds, matches };
  }, [bracket]);

  function handleCreate(size: BracketSize, teamNames: string[]) {
    const next = createBracket(size, teamNames);
    setBracket(next);
    setPanelOpen(false);
  }

  return (
    <main style={{ padding: 24, fontFamily: "ui-sans-serif, system-ui" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Correl v1</h1>
        <button
          onClick={() => setPanelOpen(true)}
          style={{
            padding: "10px 14px",
            borderRadius: 12,
            background: "#111",
            color: "white",
            fontWeight: 700,
          }}
        >
          Create Bracket
        </button>
      </div>

      <CreateBracketPanel
        isOpen={panelOpen}
        onClose={() => setPanelOpen(false)}
        onCreate={handleCreate}
      />

      <div style={{ marginTop: 18 }}>
        {!bracket ? (
          <div style={{ opacity: 0.8 }}>
            Click <b>Create Bracket</b> to generate a bracket.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ fontSize: 14, opacity: 0.8 }}>
              Created bracket: <b>{bracket.size}</b> teams ·{" "}
              <b>{summary?.rounds}</b> rounds · <b>{summary?.matches}</b>{" "}
              matches
            </div>

            <BracketView bracket={bracket} setBracket={setBracket} />
          </div>
        )}
      </div>
    </main>
  );
}
