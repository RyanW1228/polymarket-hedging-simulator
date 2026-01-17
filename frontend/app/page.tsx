// frontend/app/page.tsx

"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createBracket } from "../bracket/createBracket";
import type { BracketState, BracketSize } from "../bracket/types";
import { CreateBracketPanel } from "../components/CreateBracketPanel";
import { BracketView } from "../components/BracketView";

const BRACKETS_STORAGE_KEY = "correl_brackets_store_v1";
const LEGACY_SINGLE_BRACKET_KEY = "correl_bracket_v2";

type BracketEntry = {
  id: string;
  title: string;
  bracket: BracketState;
};

type BracketsStore = {
  activeId: string | null;
  entriesById: Record<string, BracketEntry>;
};

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function newId(): string {
  // crypto.randomUUID is supported in modern browsers; fallback just in case
  // (fallback is fine for local state ids)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = globalThis.crypto;
  return typeof c?.randomUUID === "function"
    ? c.randomUUID()
    : `b_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function makeDefaultTitle(n: number) {
  return `Tournament ${n}`;
}

export default function Home() {
  const [panelOpen, setPanelOpen] = useState(false);

  const [store, setStore] = useState<BracketsStore>(() => {
    // 1) Try to load the new multi-bracket store
    const loaded = safeJsonParse<BracketsStore>(
      localStorage.getItem(BRACKETS_STORAGE_KEY),
    );
    if (loaded && loaded.entriesById) return loaded;

    // 2) Migrate from legacy single-bracket storage if present
    const legacy = safeJsonParse<BracketState>(
      localStorage.getItem(LEGACY_SINGLE_BRACKET_KEY),
    );
    if (legacy) {
      const id = newId();
      const entry: BracketEntry = {
        id,
        title: "Tournament 1",
        bracket: legacy,
      };
      return { activeId: id, entriesById: { [id]: entry } };
    }

    // 3) Otherwise start empty
    return { activeId: null, entriesById: {} };
  });

  // Persist store
  useEffect(() => {
    try {
      localStorage.setItem(BRACKETS_STORAGE_KEY, JSON.stringify(store));
      // If we migrated, clean up the old key to avoid confusion
      localStorage.removeItem(LEGACY_SINGLE_BRACKET_KEY);
    } catch {
      // ignore storage failures
    }
  }, [store]);

  const activeEntry = useMemo(() => {
    if (!store.activeId) return null;
    return store.entriesById[store.activeId] ?? null;
  }, [store]);

  function handleCreate(size: BracketSize, teamNames: string[]) {
    const bracket = createBracket(size, teamNames);
    const id = newId();
    const nextTitle = makeDefaultTitle(
      Object.keys(store.entriesById).length + 1,
    );

    const entry: BracketEntry = {
      id,
      title: nextTitle,
      bracket,
    };

    setStore((prev) => ({
      activeId: id,
      entriesById: { ...prev.entriesById, [id]: entry },
    }));

    setPanelOpen(false);
  }

  function setActiveBracketId(id: string) {
    setStore((prev) => ({
      ...prev,
      activeId: id,
    }));
  }

  function setActiveBracket(nextBracket: BracketState) {
    setStore((prev) => {
      if (!prev.activeId) return prev;
      const curr = prev.entriesById[prev.activeId];
      if (!curr) return prev;

      return {
        ...prev,
        entriesById: {
          ...prev.entriesById,
          [prev.activeId]: { ...curr, bracket: nextBracket },
        },
      };
    });
  }

  return (
    <main style={{ padding: 24, fontFamily: "ui-sans-serif, system-ui" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Correl</h1>

          {Object.keys(store.entriesById).length > 0 && (
            <select
              value={store.activeId ?? ""}
              onChange={(e) => setActiveBracketId(e.target.value)}
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid #ddd",
                background: "white",
                fontWeight: 700,
              }}
            >
              {Object.values(store.entriesById).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </select>
          )}
        </div>

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
        {!activeEntry ? (
          <div style={{ opacity: 0.8 }}>
            Click <b>Create Bracket</b> to generate a bracket.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            <BracketView
              bracket={activeEntry.bracket}
              setBracket={setActiveBracket}
            />
          </div>
        )}
      </div>
    </main>
  );
}
