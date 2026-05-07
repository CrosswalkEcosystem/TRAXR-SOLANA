"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { TraxrScoreResult } from "@/lib/types";
import TokenLogo from "@/components/TokenLogo";

type Props = {
  pools: TraxrScoreResult[];
  value?: string;
  onChange: (poolId: string) => void;
  disabledPoolId?: string;
  accent?: "cyan" | "amber";
  placeholder?: string;
  searchable?: boolean;
  className?: string;
};

function shortAddress(address?: string) {
  if (!address) return "";
  return address.length > 12 ? `${address.slice(0, 4)}...${address.slice(-4)}` : address;
}

function tokenDisplay(opts: {
  mint?: string;
  tokenName?: string;
  tokenSymbol?: string;
  tokenAddress?: string;
}) {
  const { mint, tokenName, tokenSymbol, tokenAddress } = opts;
  if (!mint && !tokenName && !tokenSymbol) return "Token";
  if (mint === "SINGLE") return "";
  const cleanSymbol = typeof tokenSymbol === "string" ? tokenSymbol.trim() : "";
  const cleanName = typeof tokenName === "string" ? tokenName.trim() : "";
  const isBadSymbol = cleanSymbol.length <= 2 || /^[0]+$/.test(cleanSymbol);
  const isBadName = cleanName.length <= 2 || /^[0]+$/.test(cleanName);
  const base = isBadSymbol
    ? cleanName.length >= 4 && !isBadName
      ? cleanName
      : mint || "Token"
    : cleanSymbol || (isBadName ? mint || "Token" : cleanName) || "Token";
  const address = tokenAddress || mint;
  if (address && address.length > 12) {
    return `${base} (${shortAddress(address)})`;
  }
  return base;
}

function poolLabel(pool: TraxrScoreResult) {
  const m: any = pool.metrics || {};
  const tokA = tokenDisplay({
    mint: m.mintA,
    tokenName: m.tokenAName || pool.tokenAName,
    tokenSymbol: m.tokenASymbol || pool.tokenASymbol,
    tokenAddress: m.mintA,
  });
  const tokB = tokenDisplay({
    mint: m.mintB,
    tokenName: m.tokenBName || pool.tokenBName,
    tokenSymbol: m.tokenBSymbol || pool.tokenBSymbol,
    tokenAddress: m.mintB,
  });
  return tokB ? `${tokA}/${tokB}` : tokA;
}

function poolSearchText(pool: TraxrScoreResult) {
  const m: any = pool.metrics || {};
  return [
    pool.poolId,
    m.poolId,
    m.mintA,
    m.mintB,
    m.tokenAName,
    m.tokenBName,
    m.tokenASymbol,
    m.tokenBSymbol,
    pool.tokenAName,
    pool.tokenBName,
    pool.tokenASymbol,
    pool.tokenBSymbol,
    poolLabel(pool),
  ]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();
}

export function PoolCombobox({
  pools,
  value,
  onChange,
  disabledPoolId,
  accent = "cyan",
  placeholder = "Select pool",
  searchable = false,
  className = "",
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuStyle, setMenuStyle] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const selected = useMemo(
    () => pools.find((pool) => pool.poolId === value) ?? null,
    [pools, value],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pools.filter((pool) => {
      if (disabledPoolId && pool.poolId === disabledPoolId) return false;
      if (!q) return true;
      return poolSearchText(pool).includes(q);
    });
  }, [disabledPoolId, pools, query]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const updateMenuPosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuStyle({
        top: rect.bottom + 8,
        left: rect.left,
        width: rect.width,
      });
    };

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (open && searchable) {
      const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(timer);
    }
  }, [open, searchable]);

  const accentClasses =
    accent === "amber"
      ? {
          border: "focus:border-amber-400/60 border-amber-400/20",
          ring: "focus:ring-amber-400/25",
          glow: "shadow-[0_0_18px_rgba(255,200,80,0.15)]",
          active: "border-amber-400/40 bg-amber-500/10",
        }
      : {
          border: "focus:border-cyan-400/60 border-cyan-400/20",
          ring: "focus:ring-cyan-400/25",
          glow: "shadow-[0_0_18px_rgba(0,255,255,0.15)]",
          active: "border-cyan-400/40 bg-cyan-500/10",
        };

  const selectedMetrics: any = selected?.metrics || {};
  const selectedLabel = selected ? poolLabel(selected) : placeholder;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={`flex w-full items-center gap-3 rounded-xl border bg-black/40 px-3 py-2 text-left text-sm text-white outline-none ring-2 ring-transparent ${accentClasses.border} ${accentClasses.ring} ${accentClasses.glow}`}
      >
        {selected ? (
          <div className="flex shrink-0 items-center -space-x-2">
            <TokenLogo
              src={selectedMetrics.tokenALogo}
              label={selectedMetrics.tokenASymbol || selectedMetrics.tokenAName || "A"}
              className="h-8 w-8"
            />
            {selectedMetrics.mintB && selectedMetrics.mintB !== "SINGLE" ? (
              <TokenLogo
                src={selectedMetrics.tokenBLogo}
                label={selectedMetrics.tokenBSymbol || selectedMetrics.tokenBName || "B"}
                className="h-8 w-8"
              />
            ) : null}
          </div>
        ) : (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white/60">
            ?
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-white">{selectedLabel}</div>
          {selected ? (
            <div className="truncate text-[11px] uppercase tracking-[0.18em] text-white/45">
              CTS {selected.ctsNodes} • {shortAddress(selected.poolId)}
            </div>
          ) : null}
        </div>
        <div className="shrink-0 text-white/45">{open ? "▲" : "▼"}</div>
      </button>

      {open && menuStyle
        ? createPortal(
        <div
          ref={menuRef}
          className="fixed z-[1000] overflow-hidden rounded-2xl border border-white/10 bg-[#08111d]/95 shadow-[0_20px_60px_rgba(0,0,0,0.55)] backdrop-blur"
          style={{
            top: menuStyle.top,
            left: menuStyle.left,
            width: menuStyle.width,
          }}
        >
          {searchable ? (
            <div className="border-b border-white/10 p-3">
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by token, symbol, pool id, or address"
                className={`w-full rounded-xl border bg-black/40 px-3 py-2 text-sm text-white outline-none ring-2 ring-transparent ${accentClasses.border} ${accentClasses.ring}`}
              />
            </div>
          ) : null}
          <div className="traxr-scrollbar max-h-80 overflow-y-auto p-2">
            {filtered.length ? (
              filtered.map((pool) => {
                const m: any = pool.metrics || {};
                const active = pool.poolId === value;
                return (
                  <button
                    key={pool.poolId}
                    type="button"
                    onClick={() => {
                      onChange(pool.poolId);
                      setOpen(false);
                      setQuery("");
                    }}
                    className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition hover:border-white/20 hover:bg-white/6 ${active ? accentClasses.active : "border-transparent bg-transparent"}`}
                  >
                    <div className="flex shrink-0 items-center -space-x-2">
                      <TokenLogo
                        src={m.tokenALogo}
                        label={m.tokenASymbol || m.tokenAName || "A"}
                        className="h-8 w-8"
                      />
                      {m.mintB && m.mintB !== "SINGLE" ? (
                        <TokenLogo
                          src={m.tokenBLogo}
                          label={m.tokenBSymbol || m.tokenBName || "B"}
                          className="h-8 w-8"
                        />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-white">
                        {poolLabel(pool)}
                      </div>
                      <div className="truncate text-[11px] uppercase tracking-[0.18em] text-white/45">
                        CTS {pool.ctsNodes} • {shortAddress(pool.poolId)}
                      </div>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="px-3 py-4 text-sm text-white/55">No matching pools.</div>
            )}
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
