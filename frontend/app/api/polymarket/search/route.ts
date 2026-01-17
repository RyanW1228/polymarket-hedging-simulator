// frontend/app/api/polymarket/search/route.ts

import { NextResponse } from "next/server";

export const runtime = "nodejs";

function normalizeClobTokenIds(x: unknown): string[] | undefined {
  // Case 1: already string[]
  if (Array.isArray(x) && x.every((v) => typeof v === "string")) {
    // If it's ["[\"a\",\"b\"]"] (JSON array stuffed into a single string)
    if (x.length === 1 && x[0].trim().startsWith("[")) {
      try {
        const parsed = JSON.parse(x[0]);
        if (
          Array.isArray(parsed) &&
          parsed.every((v) => typeof v === "string")
        ) {
          return parsed;
        }
      } catch {}
    }
    return x;
  }

  // Case 2: single string that is a JSON array
  if (typeof x === "string" && x.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(x);
      if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string")) {
        return parsed;
      }
    } catch {}
  }

  // Case 3: single token id string
  if (typeof x === "string" && x.trim().length > 0) {
    return [x.trim()];
  }

  return undefined;
}

type PolymarketMarket = {
  id?: string | number;
  question?: string;
  marketTitle?: string;
  slug?: string;
  conditionId?: string;
  clobTokenIds?: string[] | string;
};

type PolymarketEvent = {
  id?: string | number;
  title?: string;
  name?: string;
  slug?: string;
  markets?: PolymarketMarket[] | null;
};

type MarketResult = {
  kind: "market";
  marketId: string;
  title: string;
  slug?: string;
  conditionId?: string;
  clobTokenIds?: string[];
  url?: string;
};

type EventResult = {
  kind: "event";
  eventId: string;
  title: string;
  slug?: string;
  url?: string;

  // For UI + selection UX
  marketsCount: number;

  // Lite list of markets in this event (used for auto-matching team names later)
  markets: Array<{
    marketId: string;
    title: string;
    slug?: string;
    conditionId?: string;
    clobTokenIds?: string[];
    url?: string;
  }>;

  // Helpful “best candidate” market within this event (for one-click attach later)
  bestMarket?: {
    marketId: string;
    title: string;
    slug?: string;
    conditionId?: string;
    clobTokenIds?: string[];
    url?: string;
  };
};

type AnyResult = (MarketResult | EventResult) & { _score: number };

function keywordBonus(haystack: string, q: string, perHit: number) {
  const hs = haystack.toLowerCase();
  const qq = q.toLowerCase();
  let bonus = 0;
  for (const w of qq.split(/\s+/).filter(Boolean)) {
    if (w.length >= 4 && hs.includes(w)) bonus += perHit;
  }
  return bonus;
}

function looksChampionshipLike(s: string) {
  return /\b(champion|championship|winner|who will win|which team|win the)\b/i.test(
    s,
  );
}

function computeMarketScore(
  marketTitle: string,
  tokenCount: number,
  q: string,
) {
  let score = 0;

  // Prefer multi-outcome markets when they exist
  if (tokenCount > 2) score += 200;

  // Prefer championship phrasing
  if (looksChampionshipLike(marketTitle) || looksChampionshipLike(q))
    score += 60;

  // Demote common yes/no team-prop phrasing
  if (/^will\b/i.test(marketTitle) && tokenCount <= 2) score -= 120;

  score += keywordBonus(marketTitle, q, 2);
  score += Math.min(tokenCount, 64);

  return score;
}

function computeEventScore(
  eventTitle: string,
  marketsCount: number,
  q: string,
) {
  let score = 0;

  // Event-title match is what you want when you type exact event names
  score += keywordBonus(eventTitle, q, 8);

  // If query / title looks championship-like, bump events (they often represent “futures”)
  if (looksChampionshipLike(eventTitle) || looksChampionshipLike(q))
    score += 30;

  // Events with many markets are more likely to be “full-on events” (like one market per team)
  score += Math.min(marketsCount, 100);

  return score;
}

function pickBestMarketFromEvent(ev: PolymarketEvent, q: string) {
  let best:
    | {
        market: PolymarketMarket;
        title: string;
        score: number;
      }
    | undefined;

  for (const m of ev.markets ?? []) {
    const title = (m.question ?? m.marketTitle ?? "").trim();
    if (!title) continue;

    const clobTokenIds = normalizeClobTokenIds(m.clobTokenIds);
    const tokenCount = Array.isArray(clobTokenIds) ? clobTokenIds.length : 0;

    const score = computeMarketScore(title, tokenCount, q);

    if (!best || score > best.score) {
      best = { market: m, title, score };
    }
  }

  return best;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "10"), 25);

  if (!q) return NextResponse.json({ results: [] });

  const gamma = new URL("https://gamma-api.polymarket.com/public-search");
  gamma.searchParams.set("q", q);
  gamma.searchParams.set("limit_per_type", String(limit));
  gamma.searchParams.set("search_tags", "false");
  gamma.searchParams.set("search_profiles", "false");
  gamma.searchParams.set("keep_closed_markets", "0");
  gamma.searchParams.set("events_status", "active");

  const res = await fetch(gamma.toString(), {
    headers: { accept: "application/json" },
    cache: "no-store",
  });

  if (!res.ok) {
    return NextResponse.json(
      { results: [], error: `Gamma search failed: ${res.status}` },
      { status: res.status },
    );
  }

  const data = (await res.json()) as { events?: PolymarketEvent[] | null };

  const out: AnyResult[] = [];

  for (const ev of data.events ?? []) {
    const eventTitle = (ev.title ?? ev.name ?? "").trim();
    const eventSlug = (ev.slug ?? "").trim();
    const markets = Array.isArray(ev.markets) ? ev.markets : [];
    const marketsCount = markets.length;

    // EVENT RESULT
    if (eventTitle) {
      const eventId = String(ev.id ?? eventSlug ?? eventTitle);
      const eventScore = computeEventScore(eventTitle, marketsCount, q);

      const best = pickBestMarketFromEvent(ev, q);
      let bestMarket: EventResult["bestMarket"] | undefined;

      if (best) {
        const m = best.market;
        const title = best.title;
        const slug = m.slug ?? "";
        const conditionId = m.conditionId ?? "";
        const clobTokenIds = normalizeClobTokenIds(m.clobTokenIds);

        bestMarket = {
          marketId: String(m.id ?? slug ?? conditionId ?? title),
          title,
          slug,
          conditionId,
          clobTokenIds,
          url: slug
            ? `https://polymarket.com/market/${slug}`
            : "https://polymarket.com",
        };
      }

      const eventMarkets = (ev.markets ?? [])
        .map((m) => {
          const title = (m.question ?? m.marketTitle ?? "").trim();
          if (!title) return null;

          const slug = (m.slug ?? "").trim();
          const conditionId = (m.conditionId ?? "").trim();
          const clobTokenIds = normalizeClobTokenIds(m.clobTokenIds);

          return {
            marketId: String(m.id ?? slug ?? conditionId ?? title),
            title,
            slug: slug || undefined,
            conditionId: conditionId || undefined,
            clobTokenIds,
            url: slug
              ? `https://polymarket.com/market/${slug}`
              : "https://polymarket.com",
          };
        })
        .filter(Boolean) as EventResult["markets"];

      out.push({
        kind: "event",
        eventId,
        title: eventTitle,
        slug: eventSlug || undefined,
        url: eventSlug
          ? `https://polymarket.com/event/${eventSlug}`
          : "https://polymarket.com",
        marketsCount,
        markets: eventMarkets,
        bestMarket,
        _score: eventScore + (best ? Math.max(0, best.score / 10) : 0),
      });
    }

    // MARKET RESULTS (still include some markets directly)
    // We include the “best market per event” so the list remains usable even without event selection UI.
    const best = pickBestMarketFromEvent(ev, q);
    if (best) {
      const m = best.market;
      const title = best.title;
      const slug = m.slug ?? "";
      const conditionId = m.conditionId ?? "";
      const clobTokenIds = normalizeClobTokenIds(m.clobTokenIds);

      out.push({
        kind: "market",
        marketId: String(m.id ?? slug ?? conditionId ?? title),
        title,
        slug,
        conditionId,
        clobTokenIds,
        url: slug
          ? `https://polymarket.com/market/${slug}`
          : "https://polymarket.com",
        _score: best.score + keywordBonus(eventTitle, q, 3), // modest boost from event title match
      });
    }
  }

  out.sort((a, b) => b._score - a._score);

  // de-dupe by (kind,id)
  const seen = new Set<string>();
  const results: Array<MarketResult | EventResult> = [];
  for (const r of out) {
    const key =
      r.kind === "market"
        ? `m:${r.marketId}`
        : `e:${(r as EventResult).eventId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // strip _score
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _score, ...rest } = r;
    results.push(rest as any);

    if (results.length >= limit) break;
  }

  return NextResponse.json({ results });
}
