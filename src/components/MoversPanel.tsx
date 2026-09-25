import { useState } from "react";

import Sparkline from "./Sparkline.js";
import {
  money,
  REGION_LABELS,
  useMarketSnapshot,
  type Region,
  type Ticker,
} from "../hooks/useMarketSnapshot.js";

const UP = "#0f7b4f";
const DOWN = "#b3261e";

function MoverRow({ ticker }: { ticker: Ticker }) {
  const up = ticker.changePct >= 0;
  const color = up ? UP : DOWN;
  return (
    <li
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto auto",
        gap: 10,
        alignItems: "center",
        padding: "7px 0",
        borderBottom: "1px solid #f0f0ed",
      }}
    >
      <span style={{ minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{ticker.id}</span>
        <span
          style={{
            display: "block",
            fontSize: 11,
            color: "#5f6368",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {ticker.name}
        </span>
      </span>
      <Sparkline values={ticker.spark} color={color} />
      <span style={{ textAlign: "right", fontSize: 13 }}>
        <span style={{ display: "block" }}>{money(ticker)}</span>
        <span style={{ color, fontSize: 12 }}>
          {up ? "+" : ""}
          {ticker.changePct.toFixed(2)}%
        </span>
      </span>
    </li>
  );
}

function Column({ title, rows }: { title: string; rows: Ticker[] }) {
  return (
    <section style={{ flex: 1, minWidth: 260 }}>
      <h3 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: 0.6, color: "#5f6368" }}>
        {title}
      </h3>
      {rows.length ? (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {rows.map((ticker) => (
            <MoverRow key={ticker.id} ticker={ticker} />
          ))}
        </ul>
      ) : (
        <p style={{ fontSize: 13, color: "#5f6368" }}>Nothing in this direction today.</p>
      )}
    </section>
  );
}

export default function MoversPanel() {
  const { snapshot, error } = useMarketSnapshot();
  const [region, setRegion] = useState<Region>("india");

  if (error) {
    return (
      <p role="alert" style={{ fontSize: 13, color: "#b3261e", padding: 16 }}>
        Market data unavailable ({error}).
      </p>
    );
  }
  if (!snapshot) return <p style={{ fontSize: 13, color: "#5f6368", padding: 16 }}>Loading market data…</p>;

  const data = snapshot.regions[region];

  return (
    <div style={{ padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }} role="tablist" aria-label="Market region">
        {(Object.keys(REGION_LABELS) as Region[]).map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={region === key}
            onClick={() => setRegion(key)}
            style={{
              padding: "5px 14px",
              fontSize: 13,
              borderRadius: 999,
              cursor: "pointer",
              border: "1px solid",
              borderColor: region === key ? "#1a1a1a" : "#d5d5d0",
              background: region === key ? "#1a1a1a" : "transparent",
              color: region === key ? "#fff" : "#3c4043",
            }}
          >
            {REGION_LABELS[key]}
          </button>
        ))}
      </div>

      {data ? (
        <>
          <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
            <Column title="Top gainers" rows={data.gainers} />
            <Column title="Top losers" rows={data.losers} />
          </div>
          <p style={{ fontSize: 11, color: "#80868b", marginTop: 12 }}>
            {data.tickers[0]?.live ? "Live prices" : `Last close, ${data.tickers[0]?.asOf ?? "date unavailable"}`} via{" "}
            {snapshot.provider}. Ranked within a {data.tickers.length}-stock watchlist, not the whole market.
            {snapshot.budget ? ` API calls today: ${snapshot.budget.used}/${snapshot.budget.limit}.` : ""}
          </p>
        </>
      ) : (
        <p style={{ fontSize: 13, color: "#5f6368" }}>No data for this region right now.</p>
      )}
    </div>
  );
}
