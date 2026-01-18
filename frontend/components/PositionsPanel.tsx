// frontend/components/PositionsPanel.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useAccount, useReadContracts } from "wagmi";

/**
 * Minimal ERC-1155 ABI: balanceOf(owner, id)
 * (Polymarket ConditionalTokens / CTF tokens are ERC-1155 position ids)
 */
const ERC1155_BALANCE_OF_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "id", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

type Props = {
  tokenIds: string[]; // tournament token ids (strings)
  /**
   * Called whenever positions change (manual or wallet-derived).
   * Values are base units (ERC-1155 integer units).
   */
  onPositionsChange?: (byTokenId: Record<string, string>) => void;
  /**
   * Optional: if you want to show "shares" as $-like units (1e6 = $1),
   * pass true to render both base + human.
   */
  showHumanUnits?: boolean;
};

function toHumanFromBase(base: bigint): string {
  // Polymarket convention in your project: 1e6 base units = $1
  // We format to 6 decimals without floating point.
  const denom = BigInt(1_000_000);
  const whole = base / denom;
  const frac = base % denom;
  const fracStr = frac.toString().padStart(6, "0");
  return `${whole.toString()}.${fracStr}`;
}

export function PositionsPanel({
  tokenIds,
  onPositionsChange,
  showHumanUnits = true,
}: Props) {
  const { address, isConnected } = useAccount();

  // Source selection
  const [source, setSource] = useState<"manual" | "wallet">("manual");

  // Manual positions: tokenId -> base units string
  const [manualByTokenId, setManualByTokenId] = useState<
    Record<string, string>
  >({});

  // Wallet positions: tokenId -> base units string
  const [walletByTokenId, setWalletByTokenId] = useState<
    Record<string, string>
  >({});

  const CTF_ADDRESS =
    (process.env.NEXT_PUBLIC_CTF_ADDRESS as `0x${string}` | undefined) ??
    undefined;

  const normalizedTokenIds = useMemo(() => {
    // de-dupe + stable order
    return Array.from(new Set(tokenIds.map(String))).sort();
  }, [tokenIds]);

  // Build read calls (balanceOf per tokenId).
  // If tokenIds is large, we cap to avoid hammering RPC; you can raise later.
  const MAX_READS = 80;
  const tokenIdsToRead = useMemo(
    () => normalizedTokenIds.slice(0, MAX_READS),
    [normalizedTokenIds],
  );

  const enabledWalletReads =
    source === "wallet" &&
    Boolean(CTF_ADDRESS) &&
    Boolean(address) &&
    tokenIdsToRead.length > 0;

  const { data: balancesData, isLoading } = useReadContracts({
    allowFailure: true,
    query: {
      enabled: enabledWalletReads,
    },
    contracts: enabledWalletReads
      ? tokenIdsToRead.map((tid) => ({
          address: CTF_ADDRESS!,
          abi: ERC1155_BALANCE_OF_ABI,
          functionName: "balanceOf",
          args: [address!, BigInt(tid)],
        }))
      : [],
  });

  // Update walletByTokenId when balances come in
  useEffect(() => {
    if (!enabledWalletReads) return;
    if (!balancesData) return;

    const next: Record<string, string> = {};
    for (let i = 0; i < tokenIdsToRead.length; i++) {
      const tid = tokenIdsToRead[i]!;
      const res = balancesData[i];

      // wagmi returns `{ result }` objects for read contracts
      const raw = (res as any)?.result as bigint | undefined;
      if (typeof raw === "bigint") {
        next[tid] = raw.toString();
      }
    }

    setWalletByTokenId(next);
  }, [enabledWalletReads, balancesData, tokenIdsToRead]);

  // Emit currently-selected positions upward
  useEffect(() => {
    const payload =
      source === "wallet"
        ? walletByTokenId
        : // Only include keys with non-empty values
          Object.fromEntries(
            Object.entries(manualByTokenId).filter(
              ([, v]) => String(v ?? "").trim() !== "",
            ),
          );

    onPositionsChange?.(payload);
  }, [source, manualByTokenId, walletByTokenId, onPositionsChange]);

  const activeByTokenId =
    source === "wallet" ? walletByTokenId : manualByTokenId;

  return (
    <div
      style={{
        border: "1px solid #ddd",
        borderRadius: 14,
        padding: 12,
        background: "white",
        display: "grid",
        gap: 10,
      }}
    >
      <div
        style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
      >
        <div style={{ fontWeight: 900 }}>Your positions</div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as any)}
            style={{
              fontSize: 12,
              padding: "6px 10px",
              borderRadius: 10,
              border: "1px solid #ddd",
              background: "white",
              cursor: "pointer",
              fontWeight: 800,
            }}
          >
            <option value="manual">Manual entry</option>
            <option value="wallet">Connect wallet</option>
          </select>
        </div>
      </div>

      {source === "wallet" ? (
        <div style={{ fontSize: 12, opacity: 0.8, lineHeight: 1.3 }}>
          {isConnected ? (
            <>
              Reading ERC-1155 balances for the tournament tokenIds.
              {!CTF_ADDRESS ? (
                <>
                  {" "}
                  <b>Missing</b> <code>NEXT_PUBLIC_CTF_ADDRESS</code>.
                </>
              ) : null}
              {tokenIdsToRead.length < normalizedTokenIds.length ? (
                <>
                  {" "}
                  (Reading first {tokenIdsToRead.length} /{" "}
                  {normalizedTokenIds.length} tokenIds.)
                </>
              ) : null}
            </>
          ) : (
            <>Connect your wallet (top-right) to auto-load positions.</>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 12, opacity: 0.8, lineHeight: 1.3 }}>
          Paste your holdings in <b>base units</b> (ERC-1155 integer units). If
          you bought “$3.50 worth”, that’s typically <code>3500000</code>.
        </div>
      )}

      {/* List */}
      <div style={{ display: "grid", gap: 8 }}>
        {normalizedTokenIds.length === 0 ? (
          <div style={{ opacity: 0.6 }}>No tournament tokenIds yet.</div>
        ) : (
          normalizedTokenIds.map((tid) => {
            const valStr = activeByTokenId[tid] ?? "";
            const baseBig =
              valStr && /^[0-9]+$/.test(valStr) ? BigInt(valStr) : BigInt(0);

            return (
              <div
                key={tid}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 220px",
                  gap: 10,
                  alignItems: "center",
                  padding: "8px 10px",
                  border: "1px solid #eee",
                  borderRadius: 12,
                }}
              >
                <div style={{ display: "grid", gap: 2 }}>
                  <div style={{ fontWeight: 800, fontSize: 12 }}>
                    Token ID: <code>{tid}</code>
                  </div>

                  {showHumanUnits ? (
                    <div style={{ fontSize: 12, opacity: 0.75 }}>
                      Balance: <b>{toHumanFromBase(baseBig)}</b>{" "}
                      <span style={{ opacity: 0.7 }}>
                        (base: {baseBig.toString()})
                      </span>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, opacity: 0.75 }}>
                      Balance (base): <b>{baseBig.toString()}</b>
                    </div>
                  )}
                </div>

                {source === "manual" ? (
                  <input
                    value={manualByTokenId[tid] ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setManualByTokenId((prev) => ({ ...prev, [tid]: v }));
                    }}
                    placeholder="e.g. 3500000"
                    style={{
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid #ccc",
                      background: "white",
                      color: "black",
                      fontSize: 12,
                    }}
                  />
                ) : (
                  <div
                    style={{ justifySelf: "end", fontSize: 12, opacity: 0.8 }}
                  >
                    {isLoading ? "Loading…" : ""}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
