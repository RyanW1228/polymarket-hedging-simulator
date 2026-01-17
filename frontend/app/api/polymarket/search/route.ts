// frontend/app/api/polymarket/search/route.ts

import { NextResponse } from "next/server";

export const runtime = "nodejs";

type PolymarketMarket = {
  id?: string | number;
  question?: string;
  marketTitle?: string;
  slug?: string;
  conditionId?: string;
  clobTokenIds?: string[] | string;
};

type PolymarketEvent = {
  markets?: PolymarketMarket[] | null;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "10"), 25);

  if (!q) return NextResponse.json({ results: [] });

  // Public search endpoint is /public-search :contentReference[oaicite:1]{index=1}
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
      { status: 200 },
    );
  }

  const data = (await res.json()) as { events?: PolymarketEvent[] | null };

  const flat: PolymarketMarket[] = [];
  for (const ev of data.events ?? []) {
    for (const m of ev.markets ?? []) flat.push(m);
  }

  const results = flat
    .map((m) => {
      const title = m.question ?? m.marketTitle ?? "";
      const slug = m.slug ?? "";
      const conditionId = m.conditionId ?? "";

      let clobTokenIds: string[] | undefined;
      if (Array.isArray(m.clobTokenIds)) clobTokenIds = m.clobTokenIds;
      if (typeof m.clobTokenIds === "string") {
        // sometimes docs show it as a string; handle both
        clobTokenIds = [m.clobTokenIds];
      }

      return {
        marketId: String(m.id ?? slug ?? conditionId ?? title),
        title,
        slug,
        conditionId,
        clobTokenIds,
        url: slug
          ? `https://polymarket.com/market/${slug}`
          : "https://polymarket.com",
      };
    })
    .filter((x) => x.title.length > 0)
    .slice(0, limit);

  return NextResponse.json({ results });
}
