/**
 * Dependency-free SVG charts. Server-renderable (no client JS), themed with the
 * control-room palette. Deterministic — no randomness, safe for SSR. Used across
 * the CEO, SEO and Analytics dashboards.
 */
import type { ReactNode } from "react";

export interface Point {
  label: string;
  value: number;
}

const COLORS = {
  line: "#C8A56A",
  line2: "#60A5FA",
  grid: "#1E2638",
  area: "rgba(200,165,106,0.15)",
  text: "#8A93A6",
};

/** Smooth-ish line chart with an optional second series. */
export function LineChart({
  series,
  series2,
  height = 160,
  label,
  label2,
  valueFormat = (n) => String(Math.round(n)),
}: {
  series: Point[];
  series2?: Point[];
  height?: number;
  label?: string;
  label2?: string;
  valueFormat?: (n: number) => string;
}) {
  if (series.length === 0) return <ChartEmpty height={height} />;

  const W = 600;
  const H = height;
  const padX = 8;
  const padY = 16;
  const all = [...series.map((p) => p.value), ...(series2?.map((p) => p.value) ?? [])];
  const max = Math.max(1, ...all);
  const min = Math.min(0, ...all);
  const range = max - min || 1;

  const x = (i: number, len: number) => padX + (i / Math.max(1, len - 1)) * (W - padX * 2);
  const y = (v: number) => padY + (1 - (v - min) / range) * (H - padY * 2);

  const path = (pts: Point[]) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i, pts.length).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
  const areaPath = (pts: Point[]) =>
    `${path(pts)} L ${x(pts.length - 1, pts.length).toFixed(1)} ${H - padY} L ${padX} ${H - padY} Z`;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={label ?? "line chart"}>
        {/* gridlines */}
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1={padX} x2={W - padX} y1={padY + g * (H - padY * 2)} y2={padY + g * (H - padY * 2)} stroke={COLORS.grid} strokeWidth="1" />
        ))}
        <path d={areaPath(series)} fill={COLORS.area} />
        <path d={path(series)} fill="none" stroke={COLORS.line} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {series2 && series2.length > 0 && (
          <path d={path(series2)} fill="none" stroke={COLORS.line2} strokeWidth="2" strokeDasharray="4 3" strokeLinejoin="round" />
        )}
      </svg>
      <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
        <span>{series[0]?.label}</span>
        <div className="flex gap-3">
          {label && <Legend color={COLORS.line} text={`${label} · ${valueFormat(series.at(-1)?.value ?? 0)}`} />}
          {label2 && series2 && <Legend color={COLORS.line2} text={`${label2} · ${valueFormat(series2.at(-1)?.value ?? 0)}`} />}
        </div>
        <span>{series.at(-1)?.label}</span>
      </div>
    </div>
  );
}

function Legend({ color, text }: { color: string; text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {text}
    </span>
  );
}

/** Vertical bar chart. */
export function BarChart({ data, height = 160 }: { data: Point[]; height?: number }) {
  if (data.length === 0) return <ChartEmpty height={height} />;
  const W = 600;
  const H = height;
  const max = Math.max(1, ...data.map((d) => d.value));
  const bw = (W / data.length) * 0.6;
  const gap = (W / data.length) * 0.4;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="bar chart">
        {data.map((d, i) => {
          const h = (d.value / max) * (H - 24);
          const xPos = i * (bw + gap) + gap / 2;
          return (
            <g key={i}>
              <rect x={xPos} y={H - h - 16} width={bw} height={h} rx="3" fill={COLORS.line} opacity={0.85} />
              <text x={xPos + bw / 2} y={H - 4} textAnchor="middle" fontSize="11" fill={COLORS.text}>
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Circular score gauge (0-100). */
export function ScoreRing({ score, size = 120, label }: { score: number | null; size?: number; label?: string }) {
  const v = score ?? 0;
  const r = size / 2 - 10;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.max(0, Math.min(100, v)) / 100);
  const color = score === null ? "#3A4358" : v >= 75 ? "#34D399" : v >= 50 ? "#FBBF24" : "#F87171";

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label ?? "score"} ${v} of 100`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={COLORS.grid} strokeWidth="8" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text x="50%" y="48%" textAnchor="middle" fontSize="26" fontWeight="600" fill="#E6EAF2">
          {score === null ? "—" : Math.round(v)}
        </text>
        <text x="50%" y="64%" textAnchor="middle" fontSize="11" fill={COLORS.text}>
          / 100
        </text>
      </svg>
      {label && <div className="mt-1 text-xs text-muted">{label}</div>}
    </div>
  );
}

/** Horizontal bar list — good for traffic sources, top pages, etc. */
export function BarList({ data, valueFormat = (n) => n.toLocaleString(), tone = COLORS.line }: { data: Point[]; valueFormat?: (n: number) => string; tone?: string }) {
  if (data.length === 0) return <p className="text-sm text-muted">No data.</p>;
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="space-y-2">
      {data.map((d, i) => (
        <li key={i}>
          <div className="mb-1 flex items-center justify-between gap-2 text-sm">
            <span className="truncate text-text" title={d.label}>{d.label}</span>
            <span className="shrink-0 text-muted">{valueFormat(d.value)}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
            <div className="h-full rounded-full" style={{ width: `${(d.value / max) * 100}%`, background: tone }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function ChartEmpty({ height }: { height: number }) {
  return (
    <div className="flex items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted" style={{ height }}>
      No data in range
    </div>
  );
}

export function ChartCard({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}
