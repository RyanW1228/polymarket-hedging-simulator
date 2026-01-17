// frontend/app/api/polymarket/midpoint/route.ts

import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tokenId = (url.searchParams.get("token_id") ?? "").trim();

  if (!tokenId) {
    return NextResponse.json(
      { error: "token_id is required" },
      { status: 400 },
    );
  }

  // CLOB midpoint endpoint: GET /midpoint?token_id=... :contentReference[oaicite:1]{index=1}
  const clob = new URL("https://clob.polymarket.com/midpoint");
  clob.searchParams.set("token_id", tokenId);

  const res = await fetch(clob.toString(), {
    headers: { accept: "application/json" },
    cache: "no-store",
  });

  if (!res.ok) {
    return NextResponse.json(
      { error: `CLOB midpoint failed: ${res.status}` },
      { status: 200 },
    );
  }

  const data = (await res.json()) as { mid?: string };
  return NextResponse.json({ tokenId, mid: data.mid ?? null });
}
