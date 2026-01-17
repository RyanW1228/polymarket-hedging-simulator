// frontend/components/MatchMarketSearch.tsx

"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { MarketRef } from "../bracket/types";

type SearchResult = {
  marketId: string;
  title: string;
  slug?: string;
  conditionId?: string;
  clobTokenIds?: string[];
  outcomes?: { name: string; tokenId: string }[];
  url?: string;
};

type Props = {
  value?: MarketRef;
  onChange: (next: MarketRef | undefined) => void;
};

export function MatchMarketSearch({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string>(value?.query ?? "");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const attachedTitle = value?.title;

  const trimmed = useMemo(() => query.trim(), [query]);

  // Debounced real search
  useEffect(() => {
    if (!open) return;
    if (!trimmed) {
      setResults([]);
      setError(null);
      return;
    }

    const t = setTimeout(async () => {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch(
          `/api/polymarket/search?q=${encodeURIComponent(trimmed)}&limit=10`,
        );
        const data = (await res.json()) as {
          results?: SearchResult[];
          error?: string;
        };

        if (data.error) setError(data.error);
        setResults(Array.isArray(data.results) ? data.results : []);
      } catch (e) {
        setError("Search failed");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(t);
  }, [open, trimmed]);

  async function attach(r: SearchResult) {
    // First attach what we already have…
    const base: MarketRef = {
      query: trimmed,
      venue: "polymarket",
      marketId: r.marketId,
      title: r.title,
      slug: r.slug,
      conditionId: r.conditionId,
      clobTokenIds: r.clobTokenIds,
      url: r.url,
      outcomes: r.outcomes,
    };

    // If token ids are missing, fetch full market details from Gamma /markets
    if (!base.clobTokenIds || base.clobTokenIds.length < 2) {
      try {
        const res = await fetch(
          `/api/polymarket/market?id=${encodeURIComponent(r.marketId)}`,
        );
        const full = (await res.json()) as {
          clobTokenIds?: string[] | null;
          outcomes?: { name: string; tokenId: string }[] | null;
          slug?: string;
          conditionId?: string;
          title?: string;
          url?: string;
          error?: string;
        };

        if (!full.error && Array.isArray(full.clobTokenIds)) {
          base.clobTokenIds = full.clobTokenIds;
          if (Array.isArray(full.outcomes)) {
            base.outcomes = full.outcomes;
          }
          if (!base.slug && full.slug) base.slug = full.slug;
          if (!base.conditionId && full.conditionId)
            base.conditionId = full.conditionId;
          if (!base.title && full.title) base.title = full.title;
          if (!base.url && full.url) base.url = full.url;
        }
      } catch {
        // ignore; you’ll just see dashes until token ids exist
      }
    }

    onChange(base);
    setOpen(false);
  }

  function clear() {
    onChange(undefined);
    setQuery("");
    setResults([]);
    setError(null);
    setOpen(false);
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 800 }}>Market</div>
        {value?.marketId ? (
          <button
            onClick={clear}
            style={{
              fontSize: 12,
              padding: "4px 8px",
              borderRadius: 10,
              border: "1px solid #ddd",
              background: "white",
              cursor: "pointer",
            }}
          >
            Clear
          </button>
        ) : (
          <button
            onClick={() => setOpen((v) => !v)}
            style={{
              fontSize: 12,
              padding: "4px 8px",
              borderRadius: 10,
              border: "1px solid #ddd",
              background: "white",
              cursor: "pointer",
            }}
          >
            {open ? "Close" : "Add"}
          </button>
        )}
      </div>

      {value?.marketId && attachedTitle ? (
        <div style={{ marginTop: 8, fontSize: 12 }}>
          <div style={{ fontWeight: 800 }}>{attachedTitle}</div>
          <div style={{ opacity: 0.7 }}>{value.marketId}</div>
        </div>
      ) : null}

      {open ? (
        <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='Search Polymarket (e.g. "Duke vs UNC")'
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #ccc",
              background: "white",
              color: "black",
            }}
          />

          <div style={{ fontSize: 12, opacity: 0.75 }}>
            {loading
              ? "Searching…"
              : error
                ? error
                : results.length
                  ? "Results:"
                  : trimmed
                    ? "No results"
                    : "Type to search"}
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            {results.map((r) => (
              <button
                key={r.marketId}
                onClick={() => attach(r)}
                style={{
                  textAlign: "left",
                  border: "1px solid #ddd",
                  borderRadius: 10,
                  padding: 10,
                  background: "white",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 800 }}>{r.title}</div>
                <div style={{ fontSize: 12, opacity: 0.65 }}>{r.marketId}</div>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
