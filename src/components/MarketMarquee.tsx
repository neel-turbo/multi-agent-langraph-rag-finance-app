import { useMemo } from "react";

import { money, useMarketSnapshot, type Ticker } from "../hooks/useMarketSnapshot.js";

const UP = "#0f7b4f";
const DOWN = "#b3261e";

function Item({ ticker, bold }: { ticker: Ticker; bold?: boolean }) {
  const up = ticker.changePct >= 0;
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "baseline", padding: "0 16px" }}>
      <strong style={{ fontSize: 13, letterSpacing: 0.3, color: bold ? "#1a1a1a" : "#3c4043" }}>
        {bold ? ticker.name : ticker.id}
      </strong>
      <span style={{ fontSize: 13 }}>{money(ticker)}</span>
      <span style={{ fontSize: 13, color: up ? UP : DOWN }}>
        {up ? "▲" : "▼"} {Math.abs(ticker.changePct).toFixed(2)}%
      </span>
    </span>
  );
}

/** Indices first, then the watchlists — India before world. */
export default function MarketMarquee() {
  const { snapshot } = useMarketSnapshot();

  // Rebuilt only when a new snapshot arrives, not on every render.
  const row = useMemo(() => {
    const india = snapshot?.regions.india;
    const world = snapshot?.regions.world;
    const items = [
      ...(india?.indices ?? []).map((t) => ({ ticker: t, bold: true })),
      ...(world?.indices ?? []).map((t) => ({ ticker: t, bold: true })),
      ...(india?.tickers ?? []).map((t) => ({ ticker: t, bold: false })),
      ...(world?.tickers ?? []).map((t) => ({ ticker: t, bold: false })),
    ];
    return [...items, ...items]; // duplicated so the loop has no visible seam
  }, [snapshot]);

  if (!row.length) return null;

  return (
    <div
      className="market-marquee" // sticky to the top of the page — see styles.css
      style={{
        overflow: "hidden",
        whiteSpace: "nowrap",
        borderBottom: "1px solid #e3e3e0",
        background: "#fafaf8",
        padding: "8px 0",
      }}
      aria-label="Market ticker, India and world"
    >
      <style>{`
        @keyframes marquee-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        .marquee-track { display: inline-block; animation: marquee-scroll 70s linear infinite; }
        .marquee-track:hover { animation-play-state: paused; }
        @media (prefers-reduced-motion: reduce) { .marquee-track { animation: none; } }
      `}</style>
      <div className="marquee-track">
        {row.map((item, index) => (
          <Item key={`${item.ticker.id}-${index}`} ticker={item.ticker} bold={item.bold} />
        ))}
      </div>
    </div>
  );
}
