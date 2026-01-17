// frontend/components/MatchMarketSearch.tsx

"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { MarketRef } from "../bracket/types";

type MarketResult = {
  kind: "market";
  marketId: string;
  title: string;
  slug?: string;
  conditionId?: string;
  clobTokenIds?: string[];
  outcomes?: { name: string; tokenId: string }[];
  url?: string;
};

type EventResult = {
  kind: "event";
  eventId: string;
  title: string;
  slug?: string;
  url?: string;
  marketsCount: number;
  markets: Array<{
    marketId: string;
    title: string;
    slug?: string;
    conditionId?: string;
    clobTokenIds?: string[];
    outcomes?: { name: string; tokenId: string }[];
    url?: string;
  }>;

  bestMarket?: {
    marketId: string;
    title: string;
    slug?: string;
    conditionId?: string;
    clobTokenIds?: string[];
    outcomes?: { name: string; tokenId: string }[];
    url?: string;
  };
};

type SearchResult = MarketResult | EventResult;

function isMarketResult(r: SearchResult): r is MarketResult {
  return r.kind === "market";
}

function isEventResult(r: SearchResult): r is EventResult {
  return r.kind === "event";
}

type Props = {
  value?: MarketRef;
  onChange: (next: MarketRef | undefined) => void;

  // If false, we will only show/attach "market" results (no events).
  // Default: true (current behavior).
  allowEvents?: boolean;
};

export function MatchMarketSearch({
  value,
  onChange,
  allowEvents = true,
}: Props) {
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
        const raw = Array.isArray(data.results) ? data.results : [];
        const filtered = allowEvents
          ? raw
          : raw.filter((r) => r.kind === "market");
        setResults(filtered);
      } catch (e) {
        setError("Search failed");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(t);
  }, [open, trimmed]);

  async function attachMarketLike(m: {
    marketId: string;
    title: string;
    slug?: string;
    conditionId?: string;
    clobTokenIds?: string[];
    outcomes?: { name: string; tokenId: string }[];
    url?: string;
  }) {
    const base: MarketRef = {
      query: trimmed,
      venue: "polymarket",
      marketId: m.marketId,
      title: m.title,
      slug: m.slug,
      conditionId: m.conditionId,
      clobTokenIds: m.clobTokenIds,
      url: m.url,
      outcomes: m.outcomes,
    };

    // Fetch full market details if token ids OR outcomes are missing
    if (
      !base.clobTokenIds ||
      base.clobTokenIds.length < 2 ||
      !base.outcomes ||
      base.outcomes.length < 2
    ) {
      try {
        const res = await fetch(
          `/api/polymarket/market?id=${encodeURIComponent(m.marketId)}`,
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

  async function attach(r: SearchResult) {
    if (isMarketResult(r)) {
      return attachMarketLike(r);
    }

    if (isEventResult(r)) {
      if (!allowEvents) {
        window.alert(
          "For this round, please attach a specific market (not an event).",
        );
        return;
      }

      const base: MarketRef = {
        query: trimmed,
        venue: "polymarket",
        title: r.title,
        url: r.url,
        event: {
          eventId: r.eventId,
          title: r.title,
          slug: r.slug,
          url: r.url,
          markets: r.markets,
        },
      };

      onChange(base);
      setOpen(false);
      return;
    }
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

      {(value?.marketId || (value as any)?.event?.eventId) &&
      (attachedTitle || (value as any)?.event?.title) ? (
        <div style={{ marginTop: 8, fontSize: 12, display: "grid", gap: 6 }}>
          {/* If this MarketRef was attached via an event, show the event */}
          {(value as any)?.event?.title ? (
            <div>
              <div style={{ fontSize: 11, fontWeight: 900, opacity: 0.75 }}>
                Event
              </div>
              <div style={{ fontWeight: 800 }}>
                {(value as any).event.title}
              </div>
              {(value as any)?.event?.eventId ? (
                <div style={{ opacity: 0.6, fontSize: 11 }}>
                  {(value as any).event.eventId}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Always show the attached market info if present */}
          {value?.marketId && attachedTitle ? (
            <div>
              <div style={{ fontSize: 11, fontWeight: 900, opacity: 0.75 }}>
                Market
              </div>
              <div style={{ fontWeight: 800 }}>{attachedTitle}</div>
              <div style={{ opacity: 0.7, fontSize: 11 }}>{value.marketId}</div>
            </div>
          ) : null}
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
            {results.map((r) => {
              const key =
                r.kind === "event" ? `e:${r.eventId}` : `m:${r.marketId}`;
              const topLabel =
                r.kind === "event" ? `Event • ${r.title}` : r.title;
              const subLabel =
                r.kind === "event" ? `${r.marketsCount} markets` : r.marketId;

              return (
                <button
                  key={key}
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
                  <div style={{ fontSize: 12, fontWeight: 800 }}>
                    {topLabel}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.65 }}>{subLabel}</div>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
