// frontend/app/api/polymarket/market/route.ts

import { NextResponse } from "next/server";

export const runtime = "nodejs";

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
      { status: 200 },
    );
  }

  const data = await res.json();

  // /markets may return an array; normalize to first item
  const market = Array.isArray(data) ? data[0] : data;

  if (!market)
    return NextResponse.json({ error: "Market not found" }, { status: 200 });

  return NextResponse.json({
    id: market.id != null ? String(market.id) : undefined,
    title: market.question ?? market.marketTitle ?? "",
    slug: market.slug ?? "",
    conditionId: market.conditionId ?? "",
    clobTokenIds: market.clobTokenIds ?? null,
    url: market.slug
      ? `https://polymarket.com/market/${market.slug}`
      : "https://polymarket.com",
  });
}
