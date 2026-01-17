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

function computeMarketScore(
  marketTitle: string,
  tokenCount: number,
  q: string,
) {
  const t = marketTitle.toLowerCase();
  const qq = q.toLowerCase();

  let score = 0;

  // Prefer multi-outcome
  if (tokenCount > 2) score += 200;

  // Prefer championship-ish titles
  if (
    /\b(champion|winner|win the|who will win|which team)\b/i.test(marketTitle)
  )
    score += 60;

  // Demote common yes/no phrasing for single-team props
  if (/^will\b/i.test(marketTitle) && tokenCount <= 2) score -= 120;

  // Light keyword match bonus
  for (const w of qq.split(/\s+/).filter(Boolean)) {
    if (w.length >= 4 && t.includes(w)) score += 2;
  }

  // Small additional preference for more outcomes if already multi-outcome
  score += Math.min(tokenCount, 64);

  return score;
}

function computeEventMatchBoost(eventTitle: string, q: string) {
  const et = eventTitle.toLowerCase();
  const qq = q.toLowerCase();

  let boost = 0;
  for (const w of qq.split(/\s+/).filter(Boolean)) {
    if (w.length >= 4 && et.includes(w)) boost += 8; // stronger than market keyword match
  }

  // If it looks like a championship query, boost event matches further
  if (/\b(champion|winner|who will win|win the)\b/i.test(q)) boost += 20;

  return boost;
}

function pickBestMarketFromEvent(ev: PolymarketEvent, q: string) {
  const eventTitle = (ev.title ?? ev.name ?? "").trim();
  const eventBoost = eventTitle ? computeEventMatchBoost(eventTitle, q) : 0;

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

    const s = computeMarketScore(title, tokenCount, q) + eventBoost;

    if (!best || s > best.score) {
      best = { market: m, title, score: s };
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

  // Instead of flattening all markets, pick the best market per event
  const candidates: Array<{
    marketId: string;
    title: string;
    slug: string;
    conditionId: string;
    clobTokenIds?: string[];
    url: string;
    _score: number;
  }> = [];

  for (const ev of data.events ?? []) {
    const best = pickBestMarketFromEvent(ev, q);
    if (!best) continue;

    const m = best.market;
    const title = best.title;
    const slug = m.slug ?? "";
    const conditionId = m.conditionId ?? "";
    const clobTokenIds = normalizeClobTokenIds(m.clobTokenIds);

    candidates.push({
      marketId: String(m.id ?? slug ?? conditionId ?? title),
      title,
      slug,
      conditionId,
      clobTokenIds,
      url: slug
        ? `https://polymarket.com/market/${slug}`
        : "https://polymarket.com",
      _score: best.score,
    });
  }

  // Sort by score and return top N
  candidates.sort((a, b) => b._score - a._score);

  const results = candidates.slice(0, limit).map(({ _score, ...rest }) => rest);

  return NextResponse.json({ results });
}
