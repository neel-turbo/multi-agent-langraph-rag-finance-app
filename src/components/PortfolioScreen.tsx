import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";

import { inr, signed, usePortfolio, usePriceHistory } from "../hooks/usePortfolio.js";
import type { Holding, PricePoint } from "../shared/types.js";

const pctText = (value: number): string => signed(value, (v) => `${v.toFixed(2)}%`);
const tone = (value: number): string => (value > 0 ? "up" : value < 0 ? "down" : "flat");

// ─────────── hover tooltip shared by every chart ───────────

interface Tip {
  x: number;
  y: number;
  content: ReactNode;
}

function useTooltip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const show = (event: PointerEvent, content: ReactNode) =>
    setTip({ x: event.clientX, y: event.clientY, content });
  const hide = () => setTip(null);
  const node = tip && (
    <div className="chart-tip" role="tooltip" style={{ left: tip.x + 14, top: tip.y + 14 }}>
      {tip.content}
    </div>
  );
  return { show, hide, node };
}

function HoldingTip({ holding }: { holding: Holding }) {
  return (
    <>
      <strong>
        {holding.symbol} <span className="muted">{holding.exchange}</span>
      </strong>
      <dl>
        <dt>Current value</dt>
        <dd>{inr(holding.currentValue)}</dd>
        <dt>Invested</dt>
        <dd>{inr(holding.invested)}</dd>
        <dt>P&amp;L</dt>
        <dd>
          {signed(holding.pnl, inr)} ({pctText(holding.pnlPct)})
        </dd>
        <dt>Weight</dt>
        <dd>{holding.weightPct.toFixed(1)}%</dd>
      </dl>
    </>
  );
}

// ─────────── summary tiles ───────────

function StatTile({ label, value, delta }: { label: string; value: string; delta?: { text: string; tone: string } }) {
  return (
    <div className="stat-tile">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {delta && <span className={`stat-delta ${delta.tone}`}>{delta.text}</span>}
    </div>
  );
}

// ─────────── allocation: one series, magnitude ───────────

function AllocationChart({ holdings, onSelect }: { holdings: Holding[]; onSelect: (h: Holding) => void }) {
  const tip = useTooltip();
  const max = Math.max(...holdings.map((h) => h.currentValue), 1);
  return (
    <div className="bar-chart" onPointerLeave={tip.hide}>
      {holdings.map((holding) => (
        <button
          key={holding.symbol}
          className="bar-row"
          onPointerMove={(event) => tip.show(event, <HoldingTip holding={holding} />)}
          onClick={() => onSelect(holding)}
          aria-label={`${holding.symbol}: ${inr(holding.currentValue)}, ${holding.weightPct.toFixed(1)}% of portfolio`}
        >
          <span className="bar-label">{holding.symbol}</span>
          <span className="bar-track">
            <span className="bar alloc" style={{ width: `${(holding.currentValue / max) * 100}%` }} />
          </span>
          <span className="bar-value">
            {inr(holding.currentValue, 0)} <span className="muted">{holding.weightPct.toFixed(1)}%</span>
          </span>
        </button>
      ))}
      {tip.node}
    </div>
  );
}

// ─────────── P&L: diverging around zero ───────────

function PnlChart({ holdings, onSelect }: { holdings: Holding[]; onSelect: (h: Holding) => void }) {
  const tip = useTooltip();
  const rows = [...holdings].sort((a, b) => b.pnl - a.pnl);
  const max = Math.max(...rows.map((h) => Math.abs(h.pnl)), 1);
  return (
    <div className="bar-chart" onPointerLeave={tip.hide}>
      {rows.map((holding) => {
        const width = `${(Math.abs(holding.pnl) / max) * 100}%`;
        return (
          <button
            key={holding.symbol}
            className="bar-row"
            onPointerMove={(event) => tip.show(event, <HoldingTip holding={holding} />)}
            onClick={() => onSelect(holding)}
            aria-label={`${holding.symbol}: ${signed(holding.pnl, inr)} (${pctText(holding.pnlPct)})`}
          >
            <span className="bar-label">{holding.symbol}</span>
            <span className="bar-track diverging">
              <span className="half loss">{holding.pnl < 0 && <span className="bar down" style={{ width }} />}</span>
              <span className="half gain">{holding.pnl >= 0 && <span className="bar up" style={{ width }} />}</span>
            </span>
            <span className="bar-value">
              {signed(holding.pnl, (v) => inr(v, 0))} <span className="muted">{pctText(holding.pnlPct)}</span>
            </span>
          </button>
        );
      })}
      {tip.node}
    </div>
  );
}

// ─────────── price history: line + your average buy price ───────────

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth); // first paint, before the observer's first callback
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Round tick values covering [min, max]. */
function niceTicks(min: number, max: number, count = 4): number[] {
  const raw = (max - min) / count || 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const first = Math.floor(min / step) * step;
  const last = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = first; t <= last + step / 2; t += step) ticks.push(Number(t.toFixed(6)));
  return ticks;
}

const shortDate = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

function PriceChart({ points, averagePrice }: { points: PricePoint[]; averagePrice: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const height = 260;
  const m = { top: 12, right: 16, bottom: 28, left: 64 };

  const closes = points.map((p) => p.close);
  const low = Math.min(...closes);
  const high = Math.max(...closes);
  // Draw the avg-buy line only when it's near the price range; a far-off one would flatten the line.
  const slack = (high - low) * 0.5;
  const showAvg = averagePrice >= low - slack && averagePrice <= high + slack;
  const ticks = niceTicks(showAvg ? Math.min(low, averagePrice) : low, showAvg ? Math.max(high, averagePrice) : high);
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const plotW = Math.max(width - m.left - m.right, 1);
  const plotH = height - m.top - m.bottom;
  const x = (i: number) => m.left + (points.length > 1 ? (i / (points.length - 1)) * plotW : plotW / 2);
  const y = (v: number) => m.top + (1 - (v - lo) / (hi - lo || 1)) * plotH;

  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.close).toFixed(1)}`).join("");
  const area = `${line}L${x(points.length - 1)},${y(lo)}L${x(0)},${y(lo)}Z`;
  const last = points[points.length - 1];
  const dateTicks = [0, Math.floor((points.length - 1) / 2), points.length - 1];

  const onMove = (event: PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - box.left) / box.width;
    setHover(Math.min(points.length - 1, Math.max(0, Math.round(ratio * (points.length - 1)))));
  };
  const hovered = hover !== null ? points[hover] : null;

  return (
    <div ref={ref} className="price-chart">
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Daily closing price from ${points[0].date} to ${last.date}, latest ${inr(last.close)}; your average buy price is ${inr(averagePrice)}`}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid" x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} />
              <text className="axis" x={m.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle">
                {t.toLocaleString("en-IN")}
              </text>
            </g>
          ))}
          {dateTicks.map((i, k) => (
            <text
              key={i}
              className="axis"
              x={x(i)}
              y={height - 8}
              textAnchor={k === 0 ? "start" : k === 2 ? "end" : "middle"}
            >
              {shortDate(points[i].date)}
            </text>
          ))}

          {showAvg ? (
            <>
              <line className="avg-line" x1={m.left} x2={width - m.right} y1={y(averagePrice)} y2={y(averagePrice)} />
              <text className="avg-label" x={m.left + 6} y={y(averagePrice) - 6}>
                Your avg buy {inr(averagePrice)}
              </text>
            </>
          ) : (
            <text
              className="avg-label"
              x={width - m.right - 6}
              y={averagePrice < low ? m.top + plotH - 6 : m.top + 12}
              textAnchor="end"
            >
              Your avg buy {inr(averagePrice)} is {averagePrice < low ? "below" : "above"} this range
            </text>
          )}

          <path className="price-area" d={area} />
          <path className="price-line" d={line} />
          <circle className="price-dot" cx={x(points.length - 1)} cy={y(last.close)} r={4} />

          {hovered && (
            <g pointerEvents="none">
              <line className="crosshair" x1={x(hover!)} x2={x(hover!)} y1={m.top} y2={m.top + plotH} />
              <circle className="price-dot" cx={x(hover!)} cy={y(hovered.close)} r={5} />
            </g>
          )}
          <rect
            x={m.left}
            y={m.top}
            width={plotW}
            height={plotH}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
      )}
      {hovered && (
        <div
          className="chart-tip inline"
          style={{ left: Math.min(x(hover!) + 12, Math.max(width - 190, 0)), top: m.top }}
        >
          <strong>{shortDate(hovered.date)}</strong>
          <dl>
            <dt>Close</dt>
            <dd>{inr(hovered.close)}</dd>
            <dt>vs your avg</dt>
            <dd>{pctText(((hovered.close - averagePrice) / averagePrice) * 100)}</dd>
          </dl>
        </div>
      )}
    </div>
  );
}

function PriceHistoryPanel({ holding }: { holding: Holding }) {
  const history = usePriceHistory(holding);
  const points = history.data?.points ?? [];

  let body: ReactNode;
  if (history.loading) body = <p className="muted">Loading price history…</p>;
  else if (history.error || points.length < 2)
    body = (
      <p className="muted">
        Couldn&apos;t load price history for {holding.symbol}
        {history.error ? ` (${history.error})` : ""}.{" "}
        <button className="link-button" onClick={history.reload}>
          Try again
        </button>
      </p>
    );
  else body = <PriceChart points={points} averagePrice={holding.averagePrice} />;

  return (
    <>
      {body}
      <p className="footnote">
        Daily closes for {history.data?.symbol ?? holding.symbol}, last ~6 months, from Yahoo Finance. The Kite
        demo account&apos;s prices are a fixed snapshot, so its last price won&apos;t match this chart.
      </p>
    </>
  );
}

// ─────────── holdings table (also the charts' table view) ───────────

function HoldingsTable({
  holdings,
  selected,
  onSelect,
}: {
  holdings: Holding[];
  selected: string | null;
  onSelect: (h: Holding) => void;
}) {
  return (
    <div className="table-scroll">
      <table className="holdings-table">
        <thead>
          <tr>
            <th scope="col">Stock</th>
            <th scope="col">Qty</th>
            <th scope="col">Avg price</th>
            <th scope="col">Last price</th>
            <th scope="col">Invested</th>
            <th scope="col">Current</th>
            <th scope="col">P&amp;L</th>
            <th scope="col">Day</th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((h) => (
            <tr
              key={h.symbol}
              className={selected === h.symbol ? "selected" : undefined}
              onClick={() => onSelect(h)}
              tabIndex={0}
              onKeyDown={(event) => event.key === "Enter" && onSelect(h)}
              aria-selected={selected === h.symbol}
            >
              <th scope="row">
                {h.symbol} <span className="muted">{h.exchange}</span>
              </th>
              <td>{h.quantity}</td>
              <td>{inr(h.averagePrice)}</td>
              <td>{inr(h.lastPrice)}</td>
              <td>{inr(h.invested)}</td>
              <td>{inr(h.currentValue)}</td>
              <td className={tone(h.pnl)}>
                {signed(h.pnl, inr)}
                <span className="sub">{pctText(h.pnlPct)}</span>
              </td>
              <td className={tone(h.dayChangePct)}>{pctText(h.dayChangePct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────── screen ───────────

export default function PortfolioScreen() {
  const { data: portfolio, error, loading, reload } = usePortfolio();
  const [selected, setSelected] = useState<Holding | null>(null);

  // Default the price chart to the largest holding once data arrives.
  useEffect(() => {
    if (portfolio && !selected) setSelected(portfolio.holdings[0] ?? null);
  }, [portfolio, selected]);

  if (loading && !portfolio) return <p className="portfolio-status muted">Loading your portfolio…</p>;
  if (error || !portfolio)
    return (
      <p role="alert" className="portfolio-status down">
        Couldn&apos;t load your portfolio ({error ?? "no data"}). Is the API server running on port 8787?{" "}
        <button className="link-button" onClick={reload}>
          Try again
        </button>
      </p>
    );

  const { totals, holdings } = portfolio;
  const select = (holding: Holding) => setSelected(holding);

  return (
    <div className="portfolio">
      <div className="portfolio-head">
        <div>
          <h2>Your portfolio</h2>
          <p className="muted">
            {holdings.length} holdings · {portfolio.source}
            {portfolio.accountId ? ` (${portfolio.accountId})` : ""} · updated{" "}
            {new Date(portfolio.fetchedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
        <button onClick={reload} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="stat-row">
        <StatTile label="Current value" value={inr(totals.currentValue)} />
        <StatTile label="Invested" value={inr(totals.invested)} />
        <StatTile
          label="Total P&L"
          value={signed(totals.pnl, inr)}
          delta={{ text: pctText(totals.pnlPct), tone: tone(totals.pnl) }}
        />
        <StatTile
          label="Today"
          value={signed(totals.dayChange, inr)}
          delta={{ text: pctText(totals.dayChangePct), tone: tone(totals.dayChange) }}
        />
      </div>

      <div className="chart-grid">
        <section className="chart-card">
          <h3>Allocation by current value</h3>
          <AllocationChart holdings={holdings} onSelect={select} />
        </section>
        <section className="chart-card">
          <h3>Profit &amp; loss by holding</h3>
          <PnlChart holdings={holdings} onSelect={select} />
        </section>
      </div>

      {selected && (
        <section className="chart-card">
          <div className="chart-card-head">
            <h3>{selected.symbol} price history</h3>
            <label className="muted">
              Stock{" "}
              <select
                value={selected.symbol}
                onChange={(event) => setSelected(holdings.find((h) => h.symbol === event.target.value) ?? null)}
              >
                {holdings.map((h) => (
                  <option key={h.symbol} value={h.symbol}>
                    {h.symbol}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <PriceHistoryPanel key={selected.symbol} holding={selected} />
        </section>
      )}

      <section className="chart-card">
        <h3>Holdings</h3>
        <HoldingsTable holdings={holdings} selected={selected?.symbol ?? null} onSelect={select} />
      </section>
    </div>
  );
}
