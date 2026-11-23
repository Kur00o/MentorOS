import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { scaleBand, scaleLinear } from "d3-scale";
import { area, curveCatmullRom, curveMonotoneX, line, stack } from "d3-shape";
import { BAND, bandFor, cn } from "@/lib/format";
import type { Band } from "@/lib/types";
import { CountUp, EASE } from "./core";

function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(ref.current);
    setW(Math.round(ref.current.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/* ─────────────────────────────────────────────────────────────────────────
   SIGNAL TRACE — the signature instrument.
   A seismograph line drawn by a pen nib across band zones. Hover reads off
   a value; meeting marks show where a mentor stepped in.
   ───────────────────────────────────────────────────────────────────────── */
export interface TracePoint { x: number; y: number | null; label?: string }

export function SignalTrace({
  points, height = 220, compare, marks = [], className, yMin, showZones = true, xLabel = (x: number) => `Week ${x}`, valueSuffix = "", animateDraw = true, ariaLabel,
}: {
  points: TracePoint[]; height?: number; compare?: TracePoint[]; marks?: { x: number; label: string }[]; className?: string; yMin?: number; showZones?: boolean;
  xLabel?: (x: number) => string; valueSuffix?: string; animateDraw?: boolean; ariaLabel?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const reduce = useReducedMotion();
  const pathRef = useRef<SVGPathElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const progress = useMotionValue(animateDraw && !reduce ? 0 : 1);
  const [nib, setNib] = useState<{ x: number; y: number } | null>(null);
  const uid = useId().replace(/:/g, "");
  const pad = { l: 34, r: 14, t: 14, b: 26 };
  const valid = points.filter((p) => p.y != null) as { x: number; y: number; label?: string }[];
  const lo = yMin ?? Math.max(0, Math.min(40, Math.floor((Math.min(...valid.map((p) => p.y), 100) - 8) / 10) * 10));
  const xs = scaleLinear().domain([Math.min(...points.map((p) => p.x)), Math.max(...points.map((p) => p.x), 1)]).range([pad.l, Math.max(pad.l + 10, width - pad.r)]);
  const ys = scaleLinear().domain([lo, 100]).range([height - pad.b, pad.t]);
  const gen = line<{ x: number; y: number }>().x((d) => xs(d.x)).y((d) => ys(d.y)).curve(curveCatmullRom.alpha(0.5));
  const d = width ? gen(valid) ?? "" : "";
  const cd = width && compare ? gen(compare.filter((p) => p.y != null) as { x: number; y: number }[]) ?? "" : "";
  const last = valid[valid.length - 1];
  const lastBand = bandFor(last?.y);

  useEffect(() => {
    if (!width || !d) return;
    const path = pathRef.current;
    if (!path) return;
    const len = path.getTotalLength();
    const place = (p: number) => {
      const pt = path.getPointAtLength(p * len);
      setNib({ x: pt.x, y: pt.y });
    };
    if (!animateDraw || reduce) {
      progress.set(1);
      place(1);
      return;
    }
    progress.set(0);
    const c = animate(progress, 1, { duration: 1.8, ease: [0.65, 0, 0.35, 1], onUpdate: place });
    return () => c.stop();
  }, [d, width, animateDraw, reduce, progress]);

  const onMove = (e: React.PointerEvent) => {
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    const x = xs.invert(e.clientX - rect.left);
    let best = 0;
    valid.forEach((p, i) => { if (Math.abs(p.x - x) < Math.abs(valid[best].x - x)) best = i; });
    setHover(best);
  };
  const hp = hover != null ? valid[hover] : null;
  const zones: [number, number, Band][] = [[lo, 50, "coral"], [50, 70, "amber"], [70, 100, "green"]];

  return (
    <div ref={ref} className={cn("relative w-full select-none", className)} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel ?? `Trend, latest ${last?.y?.toFixed(1) ?? "—"}`} onPointerMove={onMove} onPointerLeave={() => setHover(null)} className="overflow-visible">
          <defs>
            <linearGradient id={`fade-${uid}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={BAND[lastBand].ink} stopOpacity="0.16" />
              <stop offset="100%" stopColor={BAND[lastBand].ink} stopOpacity="0" />
            </linearGradient>
            <clipPath id={`draw-${uid}`}>
              <rect x={0} y={0} height={height} width={Math.max(0, (nib ? nib.x : 0) + 3)} />
            </clipPath>
          </defs>
          {showZones && zones.filter(([a, b]) => b > lo && a < 100).map(([a, b, band]) => (
            <g key={band}>
              <rect x={pad.l} width={width - pad.l - pad.r} y={ys(Math.min(b, 100))} height={ys(Math.max(a, lo)) - ys(Math.min(b, 100))} fill={BAND[band].wash} opacity={0.38} />
            </g>
          ))}
          {[lo, 50, 70, 100].filter((v, i, arr) => arr.indexOf(v) === i && v >= lo).map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={width - pad.r} y1={ys(v)} y2={ys(v)} stroke="rgb(var(--rule))" strokeOpacity={v === 50 || v === 70 ? 0.22 : 0.08} strokeDasharray={v === 50 || v === 70 ? "3 4" : undefined} />
              <text x={pad.l - 8} y={ys(v) + 3} textAnchor="end" className="fill-graphite-light font-mono text-[9px]">{v}</text>
            </g>
          ))}
          {valid.map((p, i) => (i % Math.ceil(valid.length / 8) === 0 || i === valid.length - 1) && (
            <text key={p.x} x={xs(p.x)} y={height - 8} textAnchor="middle" className="fill-graphite-light font-mono text-[9px]">{p.label ?? p.x}</text>
          ))}
          {marks.map((m) => (
            <g key={`${m.x}-${m.label}`} transform={`translate(${xs(m.x)},${height - pad.b})`}>
              <line y1={0} y2={-8} stroke="rgb(var(--pen))" strokeWidth={1.5} />
              <circle cy={-10} r={2.5} fill="rgb(var(--pen))" />
              <title>{m.label}</title>
            </g>
          ))}
          {cd && <path d={cd} fill="none" stroke="rgb(var(--graphite-light))" strokeWidth={1.25} strokeDasharray="2 4" />}
          <g clipPath={`url(#draw-${uid})`}>
            {d && <path d={`${d} L ${xs(last.x)} ${height - pad.b} L ${xs(valid[0].x)} ${height - pad.b} Z`} fill={`url(#fade-${uid})`} />}
            <path ref={pathRef} d={d} fill="none" stroke="rgb(var(--ink))" strokeWidth={1.9} strokeLinejoin="round" strokeLinecap="round" />
          </g>
          {nib && last && (
            <g transform={`translate(${nib.x},${nib.y})`}>
              <circle r={9} fill={BAND[lastBand].ink} opacity={0.18} className="animate-nib" style={{ transformBox: "fill-box", transformOrigin: "center" }} />
              <circle r={4} fill="rgb(var(--sheet))" stroke={BAND[lastBand].ink} strokeWidth={2.2} />
            </g>
          )}
          {hp && (
            <g pointerEvents="none">
              <line x1={xs(hp.x)} x2={xs(hp.x)} y1={pad.t} y2={height - pad.b} stroke="rgb(var(--ink))" strokeOpacity={0.35} />
              <circle cx={xs(hp.x)} cy={ys(hp.y)} r={3.5} fill="rgb(var(--ink))" />
            </g>
          )}
        </svg>
      )}
      {hp && (
        <div className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md bg-ink px-2.5 py-1.5 text-paper shadow-lift" style={{ left: Math.min(Math.max(xs(hp.x), 60), width - 60) }}>
          <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-paper/60">{xLabel(hp.x)}</div>
          <div className="tnum text-sm font-semibold">{hp.y.toFixed(1)}{valueSuffix} <span className="text-[11px] font-normal text-paper/70">{BAND[bandFor(hp.y)].label}</span></div>
        </div>
      )}
    </div>
  );
}

/* ── Micro trace for table rows ─────────────────────────────────────────── */
export function MicroTrace({ values, width = 84, height = 26, band }: { values: number[]; width?: number; height?: number; band: Band }) {
  if (values.length < 2) return <span className="text-xs text-graphite-light">—</span>;
  const lo = Math.min(...values) - 3, hi = Math.max(...values) + 3;
  const xs = scaleLinear().domain([0, values.length - 1]).range([2, width - 4]);
  const ys = scaleLinear().domain([lo, hi]).range([height - 3, 3]);
  const d = line<number>().x((_, i) => xs(i)).y((v) => ys(v)).curve(curveMonotoneX)(values) ?? "";
  return (
    <svg width={width} height={height} aria-hidden className="overflow-visible">
      <path d={d} fill="none" stroke="rgb(var(--ink-soft))" strokeWidth={1.3} strokeLinecap="round" />
      <circle cx={xs(values.length - 1)} cy={ys(values[values.length - 1])} r={2.6} fill={BAND[band].ink} />
    </svg>
  );
}

/* ── Gauge: instrument dial with sprung needle ──────────────────────────── */
export function Gauge({ value, band, size = 260, label = "Success score", sub }: { value: number | null; band: Band; size?: number; label?: string; sub?: ReactNode }) {
  const reduce = useReducedMotion();
  const target = value ?? 0;
  const spring = useSpring(reduce ? target : 0, { stiffness: 60, damping: 11, mass: 1.1 });
  useEffect(() => { spring.set(target); }, [target, spring]);
  const rotate = useTransform(spring, (v) => -90 + (Math.max(0, Math.min(100, v)) / 100) * 180);
  const r = size / 2 - 14;
  const cx = size / 2, cy = size / 2 + 4;
  const polar = (v: number, rad = r) => {
    const a = Math.PI + (v / 100) * Math.PI;
    return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
  };
  const arc = (a: number, b: number, rad: number) => {
    const [x1, y1] = polar(a, rad); const [x2, y2] = polar(b, rad);
    return `M ${x1} ${y1} A ${rad} ${rad} 0 0 1 ${x2} ${y2}`;
  };
  return (
    <div className="relative mx-auto" style={{ width: size }}>
      <svg width={size} height={size / 2 + 14} className="overflow-visible" role="img" aria-label={`${label}: ${value?.toFixed(1) ?? "no data"}`}>
        <path d={arc(0, 50, r)} stroke={BAND.coral.wash} strokeWidth={14} fill="none" />
        <path d={arc(50, 70, r)} stroke={BAND.amber.wash} strokeWidth={14} fill="none" />
        <path d={arc(70, 100, r)} stroke={BAND.green.wash} strokeWidth={14} fill="none" />
        {value != null && (
          <motion.path d={arc(0.01, Math.max(0.5, value), r)} stroke={BAND[band].ink} strokeWidth={3} fill="none" strokeLinecap="round"
            initial={{ pathLength: reduce ? 1 : 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.6, ease: [0.65, 0, 0.35, 1] }} />
        )}
        {Array.from({ length: 21 }, (_, i) => i * 5).map((t) => {
          const [x1, y1] = polar(t, r - 12); const [x2, y2] = polar(t, r - (t % 10 === 0 ? 22 : 17));
          return <line key={t} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgb(var(--ink))" strokeOpacity={t % 10 === 0 ? 0.55 : 0.22} strokeWidth={t % 10 === 0 ? 1.4 : 1} />;
        })}
        {[0, 50, 70, 100].map((t) => {
          const [x, y] = polar(t, r - 34);
          return <text key={t} x={x} y={y + 3} textAnchor="middle" className="fill-graphite font-mono text-[9px]">{t}</text>;
        })}
        {value != null && (
          <g transform={`translate(${cx},${cy})`}>
            <motion.g style={{ rotate, originX: 0.5, originY: 1 }}>
              <line x1={0} y1={0} x2={0} y2={-(r - 26)} stroke="rgb(var(--ink))" strokeWidth={2} strokeLinecap="round" />
            </motion.g>
          </g>
        )}
        <circle cx={cx} cy={cy} r={6} fill="rgb(var(--ink))" />
        <circle cx={cx} cy={cy} r={2.2} fill="rgb(var(--sheet))" />
      </svg>
      <div className="-mt-1 text-center">
        <CountUp value={value} digits={1} className="font-display text-[3.2rem] leading-none tracking-[-0.045em]" duration={1.6} />
        <div className="readout mt-1">{label}</div>
        {sub && <div className="mt-1 text-xs text-graphite">{sub}</div>}
      </div>
    </div>
  );
}

/* ── Horizontal bars with threshold ─────────────────────────────────────── */
export function BarList({ rows, unit = "%", threshold, max = 100, colorFor, onSelect }: {
  rows: { label: string; value: number | null; hint?: string; max?: number; sub?: string }[]; unit?: string; threshold?: number; max?: number;
  colorFor?: (v: number | null) => string; onSelect?: (i: number) => void;
}) {
  return (
    <ul className="space-y-3">
      {rows.map((r, i) => {
        const m = r.max ?? max;
        const w = r.value == null ? 0 : Math.max(1.5, Math.min(100, (r.value / m) * 100));
        const color = colorFor ? colorFor(r.value) : threshold != null && r.value != null && r.value < threshold ? BAND.coral.ink : "rgb(var(--ink))";
        return (
          <li key={r.label + i}>
            <button type="button" disabled={!onSelect} onClick={() => onSelect?.(i)} className="group block w-full text-left disabled:cursor-default">
              <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px]">
                <span className="truncate text-ink-soft group-enabled:group-hover:text-ink">{r.label}{r.sub && <span className="ml-2 text-xs text-graphite-light">{r.sub}</span>}</span>
                <span className="tnum shrink-0 font-medium">{r.value == null ? "—" : `${r.value.toFixed(unit === "%" ? 0 : unit ? 1 : 0)}${unit}`}{r.hint && <span className="ml-1.5 text-xs font-normal text-graphite">{r.hint}</span>}</span>
              </div>
              <div className="relative h-2 rounded-full bg-ink/[0.06]">
                <motion.div className="absolute inset-y-0 left-0 rounded-full" style={{ background: color }} initial={{ width: 0 }} whileInView={{ width: `${w}%` }} viewport={{ once: true }} transition={{ duration: 1, delay: i * 0.04, ease: EASE }} />
                {threshold != null && <div className="absolute -inset-y-1 w-px bg-ink/50" style={{ left: `${(threshold / m) * 100}%` }} />}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ── Band strata: stacked horizontal band split ─────────────────────────── */
export function BandStrata({ counts, height = 14, showLegend = true, onSelect }: { counts: Record<Band, number>; height?: number; showLegend?: boolean; onSelect?: (b: Band) => void }) {
  const order: Band[] = ["coral", "amber", "green", "insufficient_data"];
  const total = order.reduce((a, b) => a + (counts[b] || 0), 0) || 1;
  return (
    <div>
      <div className="flex w-full gap-[3px] overflow-hidden rounded-full" style={{ height }}>
        {order.map((b, i) => (counts[b] ? (
          <motion.button type="button" key={b} title={`${BAND[b].label}: ${counts[b]}`} onClick={() => onSelect?.(b)} className="h-full first:rounded-l-full last:rounded-r-full"
            style={{ background: b === "insufficient_data" ? BAND[b].wash : BAND[b].ink }} initial={{ flexGrow: 0.0001 }} animate={{ flexGrow: counts[b] / total }} transition={{ duration: 1.1, delay: 0.1 * i, ease: EASE }} />
        ) : null))}
      </div>
      {showLegend && (
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
          {order.map((b) => (
            <button key={b} type="button" onClick={() => onSelect?.(b)} className="flex items-center gap-2 text-[13px] text-ink-soft hover:text-ink">
              <span className="h-2 w-2 rounded-full" style={{ background: BAND[b].ink }} />
              {BAND[b].label}<span className="tnum font-semibold text-ink">{counts[b] || 0}</span>
              <span className="tnum text-xs text-graphite-light">{Math.round(((counts[b] || 0) / total) * 100)}%</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Cohort strata over time (stacked area of band counts) ──────────────── */
export function CohortStrata({ data, height = 200 }: { data: ({ week: number } & Record<Band, number>)[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const keys: Band[] = ["coral", "amber", "green", "insufficient_data"];
  const [hover, setHover] = useState<number | null>(null);
  const series = useMemo(() => stack<{ week: number } & Record<Band, number>, Band>().keys(keys)(data), [data]);
  const pad = { l: 8, r: 8, t: 8, b: 22 };
  const max = Math.max(1, ...data.map((d) => keys.reduce((a, k) => a + (d[k] || 0), 0)));
  const xs = scaleLinear().domain([data[0]?.week ?? 0, data[data.length - 1]?.week ?? 1]).range([pad.l, width - pad.r]);
  const ys = scaleLinear().domain([0, max]).range([height - pad.b, pad.t]);
  const gen = area<[number, number] & { data: { week: number } }>().x((d) => xs(d.data.week)).y0((d) => ys(d[0])).y1((d) => ys(d[1])).curve(curveMonotoneX);
  const h = hover != null ? data[hover] : null;
  return (
    <div ref={ref} className="relative" style={{ height }}>
      {width > 0 && data.length > 1 && (
        <svg width={width} height={height} onPointerLeave={() => setHover(null)} onPointerMove={(e) => {
          const x = xs.invert(e.clientX - e.currentTarget.getBoundingClientRect().left);
          let best = 0; data.forEach((d, i) => { if (Math.abs(d.week - x) < Math.abs(data[best].week - x)) best = i; }); setHover(best);
        }}>
          {series.map((s, i) => (
            <motion.path key={s.key} d={gen(s as never) ?? ""} fill={s.key === "insufficient_data" ? BAND[s.key].wash : BAND[s.key].ink} fillOpacity={s.key === "green" ? 0.22 : s.key === "insufficient_data" ? 0.9 : 0.75}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.12, duration: 0.8 }} />
          ))}
          {data.map((d, i) => (i % 3 === 0 || i === data.length - 1) && <text key={d.week} x={xs(d.week)} y={height - 6} textAnchor="middle" className="fill-graphite-light font-mono text-[9px]">W{d.week}</text>)}
          {h && <line x1={xs(h.week)} x2={xs(h.week)} y1={pad.t} y2={height - pad.b} stroke="rgb(var(--ink))" strokeOpacity={0.4} />}
        </svg>
      )}
      {h && (
        <div className="pointer-events-none absolute top-1 rounded-md bg-ink px-2.5 py-1.5 text-xs text-paper shadow-lift" style={{ left: Math.min(xs(h.week) + 10, width - 140) }}>
          <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-paper/60">Week {h.week}</div>
          {keys.filter((k) => h[k]).map((k) => <div key={k} className="tnum">{BAND[k].label}: <b>{h[k]}</b></div>)}
        </div>
      )}
    </div>
  );
}

/* ── Semester × band heat grid ──────────────────────────────────────────── */
export function BandHeatmap({ rows }: { rows: ({ semester: number; total: number; avg_score: number | null } & Record<Band, number>)[] }) {
  const cols: Band[] = ["green", "amber", "coral", "insufficient_data"];
  const max = Math.max(1, ...rows.flatMap((r) => cols.map((c) => r[c])));
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-1.5 text-sm">
        <thead>
          <tr>
            <th className="readout text-left font-normal">Sem</th>
            {cols.map((c) => <th key={c} className="readout text-center font-normal">{BAND[c].short}</th>)}
            <th className="readout text-right font-normal">Avg</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.semester}>
              <td className="font-display text-lg">{r.semester}</td>
              {cols.map((c) => {
                const v = r[c];
                const o = v ? 0.18 + (v / max) * 0.82 : 0;
                return (
                  <td key={c} className="h-11 min-w-[56px] rounded-md text-center align-middle hairline" style={{ background: v ? `color-mix(in srgb, ${BAND[c].ink} ${Math.round(o * 100)}%, transparent)` : "transparent" }}>
                    <span className={cn("tnum font-semibold", o > 0.55 ? "text-white" : "text-ink")}>{v || ""}</span>
                  </td>
                );
              })}
              <td className="tnum text-right font-medium">{r.avg_score?.toFixed(1) ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Column histogram (score distribution) ──────────────────────────────── */
export function Histogram({ data, height = 150 }: { data: { bucket: string; lo: number; count: number }[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const xs = scaleBand<string>().domain(data.map((d) => d.bucket)).range([0, width]).padding(0.18);
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div ref={ref} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height}>
          {data.map((d, i) => {
            const h = (d.count / max) * (height - 30);
            return (
              <g key={d.bucket}>
                <motion.rect x={xs(d.bucket)} width={xs.bandwidth()} rx={3} fill={BAND[bandFor(d.lo + 5)].ink} fillOpacity={0.85}
                  initial={{ height: 0, y: height - 18 }} animate={{ height: h, y: height - 18 - h }} transition={{ duration: 0.9, delay: i * 0.05, ease: EASE }} />
                <text x={(xs(d.bucket) ?? 0) + xs.bandwidth() / 2} y={height - 22 - h} textAnchor="middle" className="fill-ink-soft text-[10px] tnum">{d.count || ""}</text>
                <text x={(xs(d.bucket) ?? 0) + xs.bandwidth() / 2} y={height - 4} textAnchor="middle" className="fill-graphite-light font-mono text-[9px]">{d.lo}</text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

/* ── Weekly activity strip (LMS / attendance) ───────────────────────────── */
export function WeekStrip({ values, max, labelFor, color = "rgb(var(--pen))" }: { values: number[]; max?: number; labelFor?: (i: number, v: number) => string; color?: string }) {
  const m = max ?? Math.max(1, ...values);
  return (
    <div className="flex items-end gap-[3px]">
      {values.map((v, i) => (
        <div key={i} title={labelFor?.(i, v)} className="flex-1">
          <motion.div className="w-full rounded-[3px]" style={{ background: color, opacity: v === 0 ? 0.12 : 0.25 + 0.75 * (v / m) }}
            initial={{ height: 2 }} whileInView={{ height: 6 + (v / m) * 38 }} viewport={{ once: true }} transition={{ duration: 0.7, delay: i * 0.02, ease: EASE }} />
        </div>
      ))}
    </div>
  );
}

/* ── Funnel ─────────────────────────────────────────────────────────────── */
export function Funnel({ stages }: { stages: { stage: string; count: number }[] }) {
  const max = Math.max(1, ...stages.map((s) => s.count));
  return (
    <div className="space-y-1.5">
      {stages.map((s, i) => (
        <div key={s.stage} className="grid grid-cols-[120px_1fr_40px] items-center gap-3 text-[13px] sm:grid-cols-[150px_1fr_44px]">
          <span className="truncate text-ink-soft">{s.stage}</span>
          <div className="flex h-7 justify-center">
            <motion.div className="h-full rounded-sm bg-pen" style={{ opacity: 1 - i * 0.12 }} initial={{ width: 0 }} whileInView={{ width: `${Math.max(2, (s.count / max) * 100)}%` }} viewport={{ once: true }} transition={{ duration: 1, delay: i * 0.07, ease: EASE }} />
          </div>
          <span className="tnum text-right font-semibold">{s.count}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Pillar bars (score composition) ────────────────────────────────────── */
export function PillarStack({ components, weights }: { components: Record<string, number | null>; weights: Record<string, number> }) {
  const keys = ["attendance", "academic", "engagement", "placement"];
  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full bg-ink/[0.06]">
      {keys.map((k, i) => {
        const v = components[k] ?? 0;
        return (
          <div key={k} className="relative h-full" style={{ width: `${weights[k] * 100}%` }}>
            <motion.div className="absolute inset-y-0 left-0" style={{ background: `rgb(var(--ink) / ${0.9 - i * 0.18})` }} initial={{ width: 0 }} animate={{ width: `${v}%` }} transition={{ duration: 1.1, delay: 0.15 * i, ease: EASE }} />
            {i < 3 && <div className="absolute inset-y-0 right-0 w-[2px] bg-sheet" />}
          </div>
        );
      })}
    </div>
  );
}
