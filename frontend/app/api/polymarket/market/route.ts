// frontend/app/api/polymarket/market/route.ts

import { NextResponse } from "next/server";

export const runtime = "nodejs";

function normalizeClobTokenIds(x: unknown): string[] | null {
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

  return null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = (url.searchParams.get("id") ?? "").trim();
  const slug = (url.searchParams.get("slug") ?? "").trim();

  if (!id && !slug) {
    return NextResponse.json(
      { error: "id or slug is required" },
      { status: 400 },
    );
  }

  // Gamma Get Markets endpoint :contentReference[oaicite:1]{index=1}
  const gamma = new URL("https://gamma-api.polymarket.com/markets");
  if (id) gamma.searchParams.set("id", id);
  if (slug) gamma.searchParams.set("slug", slug);

  const res = await fetch(gamma.toString(), {
    headers: { accept: "application/json" },
    cache: "no-store",
  });

  if (!res.ok) {
    return NextResponse.json(
      { error: `Gamma markets failed: ${res.status}` },
      { status: res.status },
    );
  }

  const data = await res.json();

  // /markets may return an array; normalize to first item
  const market = Array.isArray(data) ? data[0] : data;

  if (!market)
    return NextResponse.json({ error: "Market not found" }, { status: 404 });

  return NextResponse.json({
    id: market.id != null ? String(market.id) : undefined,
    title: market.question ?? market.marketTitle ?? "",
    slug: market.slug ?? "",
    conditionId: market.conditionId ?? "",
    clobTokenIds: normalizeClobTokenIds(market.clobTokenIds),
    url: market.slug
      ? `https://polymarket.com/market/${market.slug}`
      : "https://polymarket.com",
  });
}
