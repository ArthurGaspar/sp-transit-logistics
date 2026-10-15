import { useState, type MouseEvent } from "react";

interface Tip {
  x: number;
  y: number;
  text: string;
}

function TipLayer({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div className="chart-tip" style={{ left: tip.x + 12, top: tip.y + 12 }}>
      {tip.text}
    </div>
  );
}

/**
 * Single-series horizontal bars with a zero baseline, so negative values
 * (e.g. an R² worse than predicting the mean) extend to the left.
 */
export function HBarChart({
  data,
  format,
  domain,
  ariaLabel,
}: {
  data: { label: string; value: number; note?: string }[];
  format: (v: number) => string;
  domain?: [number, number];
  ariaLabel: string;
}) {
  const [tip, setTip] = useState<Tip | null>(null);
  const width = 640;
  const labelW = 150;
  const valueW = 56;
  const rowH = 30;
  const barH = 14;
  const height = data.length * rowH + 24;
  const lo = Math.min(0, domain?.[0] ?? Math.min(...data.map((d) => d.value)));
  const hi = Math.max(0, domain?.[1] ?? Math.max(...data.map((d) => d.value)));
  const plotW = width - labelW - valueW;
  const x = (v: number) => labelW + ((v - lo) / (hi - lo || 1)) * plotW;
  const ticks = niceTicks(lo, hi, 4);
  const show = (e: MouseEvent, text: string) => setTip({ x: e.clientX, y: e.clientY, text });

  return (
    <>
      <svg className="chart" viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={ariaLabel}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={x(t)} x2={x(t)} y1={0} y2={height - 20} />
            <text x={x(t)} y={height - 6} textAnchor="middle">{format(t)}</text>
          </g>
        ))}
        <line className="axis" x1={x(0)} x2={x(0)} y1={0} y2={height - 20} strokeWidth={1.5} />
        {data.map((d, i) => {
          const y = i * rowH + (rowH - barH) / 2;
          const x0 = x(Math.min(0, d.value));
          const w = Math.max(1, Math.abs(x(d.value) - x(0)));
          const neg = d.value < 0;
          const text = `${d.label}: ${format(d.value)}${d.note ? ` (${d.note})` : ""}`;
          return (
            <g key={d.label} onMouseMove={(e) => show(e, text)} onMouseLeave={() => setTip(null)}>
              <rect x={0} y={i * rowH} width={width} height={rowH} fill="transparent" />
              <text x={labelW - 10} y={y + barH - 3} textAnchor="end">{d.label}</text>
              <path d={roundedBar(x0, y, w, barH, neg)} fill={neg ? "var(--bar-negative)" : "var(--bar)"} />
              <text x={width - 4} y={y + barH - 3} textAnchor="end" style={{ fill: "var(--text-primary)" }}>
                {format(d.value)}
              </text>
            </g>
          );
        })}
      </svg>
      <TipLayer tip={tip} />
    </>
  );
}

/** Rounded only at the data end; the baseline end stays square. */
function roundedBar(x: number, y: number, w: number, h: number, leftEnd: boolean): string {
  const r = Math.min(4, w / 2, h / 2);
  if (leftEnd) {
    return `M${x + w},${y} H${x + r} A${r},${r} 0 0 0 ${x},${y + r} V${y + h - r} A${r},${r} 0 0 0 ${x + r},${y + h} H${x + w} Z`;
  }
  return `M${x},${y} H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r} V${y + h - r} A${r},${r} 0 0 1 ${x + w - r},${y + h} H${x} Z`;
}

/** Single-series line over 24 hours with a crosshair tooltip. */
export function HourlyLine({ values, unit, ariaLabel }: { values: number[]; unit: string; ariaLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 640;
  const height = 200;
  const pad = { l: 36, r: 12, t: 12, b: 24 };
  const finite = values.filter(Number.isFinite);
  const lo = Math.floor(Math.min(...finite) - 1);
  const hi = Math.ceil(Math.max(...finite) + 1);
  const x = (h: number) => pad.l + (h / 23) * (width - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (height - pad.t - pad.b);
  const path = values
    .map((v, h) => (Number.isFinite(v) ? `${h === 0 || !Number.isFinite(values[h - 1]) ? "M" : "L"}${x(h)},${y(v)}` : ""))
    .join(" ");

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      role="img"
      aria-label={ariaLabel}
      onMouseMove={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        const px = ((e.clientX - box.left) / box.width) * width;
        setHover(Math.max(0, Math.min(23, Math.round(((px - pad.l) / (width - pad.l - pad.r)) * 23))));
      }}
      onMouseLeave={() => setHover(null)}
    >
      {niceTicks(lo, hi, 4).map((t) => (
        <g key={t}>
          <line className="grid" x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} />
          <text x={pad.l - 6} y={y(t) + 4} textAnchor="end">{t}</text>
        </g>
      ))}
      {[0, 6, 12, 18, 23].map((h) => (
        <text key={h} x={x(h)} y={height - 6} textAnchor="middle">{h}h</text>
      ))}
      <path d={path} fill="none" stroke="var(--bar)" strokeWidth={2} strokeLinejoin="round" />
      {hover !== null && Number.isFinite(values[hover]) && (
        <g>
          <line className="axis" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={height - pad.b} />
          <circle cx={x(hover)} cy={y(values[hover])} r={5} fill="var(--bar)" stroke="var(--surface-1)" strokeWidth={2} />
          <text
            x={Math.min(x(hover) + 8, width - 90)}
            y={pad.t + 12}
            style={{ fill: "var(--text-primary)", fontWeight: 600 }}
          >
            {hover}:00 · {values[hover].toFixed(1)} {unit}
          </text>
        </g>
      )}
    </svg>
  );
}

function niceTicks(lo: number, hi: number, count: number): number[] {
  const span = hi - lo || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? raw;
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) ticks.push(+t.toFixed(10));
  return ticks;
}
