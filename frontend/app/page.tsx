// frontend/app/page.tsx

"use client";

import React, { useEffect, useState } from "react";
import { createBracket } from "../bracket/createBracket";
import type { BracketState, BracketSize } from "../bracket/types";
import { CreateBracketPanel } from "../components/CreateBracketPanel";
import { BracketView } from "../components/BracketView";

const BRACKET_STORAGE_KEY = "correl_bracket_v1";

export default function Home() {
  const [panelOpen, setPanelOpen] = useState(false);
  const [bracket, setBracket] = useState<BracketState | null>(() => {
    try {
      const raw = localStorage.getItem(BRACKET_STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as BracketState;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    try {
      if (!bracket) {
        localStorage.removeItem(BRACKET_STORAGE_KEY);
        return;
      }
      localStorage.setItem(BRACKET_STORAGE_KEY, JSON.stringify(bracket));
    } catch {
      // ignore storage failures
    }
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
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Correl</h1>
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
            <BracketView bracket={bracket} setBracket={setBracket} />
          </div>
        )}
      </div>
    </main>
  );
}
