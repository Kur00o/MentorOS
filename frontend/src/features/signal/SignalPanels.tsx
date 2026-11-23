/** Shared "signal" building blocks: used by the student's own desk and by
 *  the staff Student 360 view, so both read the exact same numbers. */
import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { AlertTriangle, CircleCheck, Info } from "lucide-react";
import { api } from "@/lib/api";
import { BAND, PILLARS, cn, date, num, relative, RULE_LABEL } from "@/lib/format";
import type { Alert, Overview, Pillar } from "@/lib/types";
import { BandChip, Badge, Delta, EASE, Meter, Sheet } from "@/ui/core";
import { BarList, Gauge, SignalTrace, WeekStrip } from "@/ui/charts";

export function ScoreGaugeSheet({ ov, compact }: { ov: Overview; compact?: boolean }) {
  const s = ov.score;
  return (
    <Sheet tone="stack" className="flex flex-col" label={`Score · ${ov.period}`} action={<BandChip band={s.band} />}>
      <Gauge value={s.total} band={s.band} size={compact ? 240 : 280} label={s.total == null ? "Awaiting data" : BAND[s.band].label}
        sub={s.total == null ? "Attendance or results not imported yet" : <span className="inline-flex items-center gap-1.5"><Delta value={s.delta} /> since last computation · {relative(s.updated_at)}</span>} />
      <p className="mt-4 border-t border-rule/10 pt-4 text-center text-[13px] text-graphite">{BAND[s.band].guide}</p>
    </Sheet>
  );
}

export function TraceSheet({ ov, title = "Your signal over the term" }: { ov: Overview; title?: string }) {
  const points = ov.history.filter((h) => h.period === ov.period && h.total != null).map((h, i) => ({ x: h.week ?? i + 1, y: h.total }));
  const weekOf = (iso: string) => {
    const first = ov.attendance.weekly[0]?.week_start;
    if (!first) return null;
    return Math.floor((new Date(iso).getTime() - new Date(first).getTime()) / (7 * 864e5)) + 1;
  };
  const marks = [...ov.meetings.past].filter((m) => m.status === "completed").map((m) => ({ x: weekOf(m.scheduled_at) ?? 0, label: `Meeting: ${m.title} (${date(m.scheduled_at)})` }))
    .filter((m) => m.x > 0 && points.length && m.x >= points[0].x && m.x <= points[points.length - 1].x);
  return (
    <Sheet label="Signal trace" title={title}
      action={<span className="hidden items-center gap-1.5 text-[11px] text-graphite sm:flex"><span className="h-2 w-2 rounded-full bg-pen" />mentor meeting</span>}>
      {points.length > 1 ? <SignalTrace points={points} marks={marks} height={260} ariaLabel="Success score by week" /> : <p className="py-16 text-center text-sm text-graphite">The trace appears after a few weeks of data.</p>}
    </Sheet>
  );
}

export function PillarGrid({ ov }: { ov: Overview }) {
  const s = ov.score;
  const detail: Record<Pillar, string> = {
    attendance: ov.attendance.overall_pct == null ? "No attendance imported" : `${ov.attendance.attended}/${ov.attendance.total} classes`,
    academic: ov.academics.sgpa == null ? "No declared SGPA yet" : `SGPA ${ov.academics.sgpa.toFixed(2)} · CGPA ${num(ov.academics.cgpa, 2)}`,
    engagement: ov.engagement.login_count == null ? "No LMS activity" : `${ov.engagement.login_count} logins · ${ov.engagement.assignments_submitted}/${ov.engagement.assignments_total} submitted`,
    placement: `${ov.placement.has_resume ? "Resume ✓" : "No resume"} · ${ov.placement.skills.length} skills · ${ov.placement.certifications.length} certs`,
  };
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {PILLARS.map((p, i) => {
        const v = s.components[p.key];
        const lost = v == null ? null : p.weight * (100 - v);
        const weakest = s.weakest === p.key;
        return (
          <motion.div key={p.key} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.08 * i, ease: EASE }}
            className={cn("relative rounded-lg bg-sheet p-5 shadow-sheet hairline", weakest && "ring-1 ring-pen/40")}>
            <div className="flex items-center justify-between">
              <span className="readout">{p.label} · {Math.round(p.weight * 100)}%</span>
              {weakest && <Badge tone="pen">Biggest lever</Badge>}
            </div>
            <div className="mt-3 flex items-baseline gap-1">
              <span className="font-display text-[2.3rem] leading-none tracking-[-0.04em]">{num(v, 0)}</span>
              <span className="text-sm text-graphite">/100</span>
            </div>
            <Meter value={v} className="mt-3" color={v == null ? undefined : v >= 70 ? BAND.green.ink : v >= 50 ? BAND.amber.ink : BAND.coral.ink} />
            <p className="mt-3 text-xs text-graphite">{detail[p.key]}</p>
            {lost != null && lost > 0.5 && <p className="mt-1 text-xs text-ink-soft">−{lost.toFixed(1)} pts on your total</p>}
          </motion.div>
        );
      })}
    </div>
  );
}

const SEV_TONE = { high: "critical", medium: "watch", low: "neutral" } as const;

export function AlertList({ alerts, empty = "No open alerts — the trace looks steady." }: { alerts: Alert[]; empty?: string }) {
  const open = alerts.filter((a) => a.status !== "resolved");
  if (!open.length)
    return <div className="flex items-center gap-3 rounded-md bg-thrive-wash/60 px-4 py-3 text-sm text-thrive"><CircleCheck size={16} />{empty}</div>;
  return (
    <ul className="divide-y divide-rule/10">
      {open.map((a) => (
        <li key={a.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
          <AlertTriangle size={16} className={cn("mt-0.5 shrink-0", a.severity === "high" ? "text-critical" : a.severity === "medium" ? "text-watch" : "text-graphite")} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{RULE_LABEL[a.rule] ?? a.title}</span>
              <Badge tone={SEV_TONE[a.severity]}>{a.severity}</Badge>
              {a.status === "acknowledged" && <Badge tone="pen">acknowledged</Badge>}
            </div>
            <p className="mt-0.5 text-[13px] text-graphite">{a.detail}</p>
          </div>
          <span className="readout shrink-0 !text-[9px]">{relative(a.created_at)}</span>
        </li>
      ))}
    </ul>
  );
}

export function SubjectAttendanceList({ ov, selfView }: { ov: Overview; selfView?: boolean }) {
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {ov.attendance.subjects.map((s, i) => {
        const short = s.pct != null && s.pct < 75;
        return (
          <motion.li key={s.subject_id} initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: i * 0.05, ease: EASE }}
            className="rounded-lg bg-sheet p-4 shadow-sheet hairline">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="readout">{s.code} · {s.kind}</div>
                <div className="mt-0.5 truncate font-medium">{s.name}</div>
                {s.faculty && <div className="truncate text-xs text-graphite">{s.faculty}</div>}
              </div>
              <div className="text-right">
                <div className={cn("font-display text-[1.9rem] leading-none tracking-[-0.04em]", short ? "text-critical" : "text-ink")}>{num(s.pct, 0)}<span className="text-base">%</span></div>
                <div className="tnum text-xs text-graphite">{s.attended}/{s.total}</div>
              </div>
            </div>
            <Meter value={s.pct} threshold={75} className="mt-3" color={short ? BAND.coral.ink : s.pct != null && s.pct < 82 ? BAND.amber.ink : BAND.green.ink} />
            <p className={cn("mt-2.5 text-xs", short ? "text-critical" : "text-graphite")}>
              {short ? `Attend the next ${s.needed_for_75} class${s.needed_for_75 === 1 ? "" : "es"} in a row to reach 75%.`
                : s.can_skip > 0 ? `${selfView ? "You can" : "Can"} miss ${s.can_skip} class${s.can_skip === 1 ? "" : "es"} and stay above 75%.` : "Right on the 75% line — no margin."}
            </p>
          </motion.li>
        );
      })}
    </ul>
  );
}

export function AttendanceTrend({ ov }: { ov: Overview }) {
  const pts = ov.attendance.weekly.map((w) => ({ x: w.week, y: w.pct }));
  return <SignalTrace points={pts} height={220} showZones={false} yMin={Math.min(40, ...pts.map((p) => p.y ?? 100)) - 5} valueSuffix="%" ariaLabel="Weekly attendance" />;
}

export function MarksPanel({ ov }: { ov: Overview }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {ov.academics.subjects.map((s) => (
        <div key={s.subject_id} className="rounded-lg bg-sheet p-4 shadow-sheet hairline">
          <div className="flex items-start justify-between">
            <div><div className="readout">{s.code}</div><div className="font-medium">{s.name}</div></div>
            <div className={cn("font-display text-2xl tracking-[-0.03em]", s.pct != null && s.pct < 40 ? "text-critical" : s.pct != null && s.pct < 55 ? "text-watch" : "")}>{num(s.pct, 0)}%</div>
          </div>
          <ul className="mt-3 space-y-2">
            {s.assessments.map((a) => (
              <li key={a.assessment} className="grid grid-cols-[110px_1fr_56px] items-center gap-3 text-xs">
                <span className="truncate capitalize text-graphite">{a.assessment.replace(/_/g, " ")}</span>
                <Meter value={(a.obtained / a.max) * 100} threshold={40} height={5} color={a.obtained / a.max < 0.4 ? BAND.coral.ink : "rgb(var(--ink))"} />
                <span className="tnum text-right font-medium">{a.obtained}/{a.max}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function SemesterSgpa({ ov }: { ov: Overview }) {
  if (!ov.academics.semesters.length) return <p className="py-6 text-sm text-graphite">No declared semester results yet — first-semester students get an SGPA after end-semester exams.</p>;
  return (
    <BarList rows={ov.academics.semesters.map((r) => ({ label: `Semester ${r.semester}`, value: r.sgpa, max: 10, hint: r.backlogs ? `${r.backlogs} backlog${r.backlogs > 1 ? "s" : ""}` : undefined }))}
      unit="" max={10} threshold={6} colorFor={(v) => (v == null ? "" : v >= 7 ? BAND.green.ink : v >= 6 ? BAND.amber.ink : BAND.coral.ink)} />
  );
}

export function EngagementPanel({ ov }: { ov: Overview }) {
  const e = ov.engagement;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          ["Logins", e.login_count, e.cohort_avg_logins != null ? `dept avg ${e.cohort_avg_logins.toFixed(0)}` : ""],
          ["Submitted", e.assignments_submitted, `of ${e.assignments_total ?? 0} assignments`],
          ["Quiz avg", e.avg_quiz_score, `${e.quizzes_attempted ?? 0} attempted`],
          ["Active hours", e.active_minutes != null ? Math.round(e.active_minutes / 60) : null, `last seen ${relative(e.last_active_at)}`],
        ].map(([l, v, h]) => (
          <div key={String(l)}><div className="readout">{l}</div><div className="mt-1 font-display text-3xl tracking-[-0.04em]">{v == null ? "—" : Number(v).toFixed(0)}</div><div className="text-xs text-graphite">{h}</div></div>
        ))}
      </div>
      <div>
        <div className="readout mb-2">Weekly LMS logins</div>
        <WeekStrip values={e.weekly.map((w) => w.logins)} labelFor={(i, v) => `Week ${i + 1}: ${v} logins`} />
        <div className="mt-1 flex justify-between font-mono text-[9px] text-graphite-light"><span>W1</span><span>W{e.weekly.length}</span></div>
      </div>
    </div>
  );
}

/* ── What-if simulator ─────────────────────────────────────────────────── */
function Slider({ label, value, set, min, max, step = 1, fmt }: { label: string; value: number; set: (v: number) => void; min: number; max: number; step?: number; fmt: (v: number) => string }) {
return (
  <label className="block">
    <div className="mb-1.5 flex justify-between text-[13px]"><span className="text-ink-soft">{label}</span><span className="tnum font-semibold">{fmt(value)}</span></div>
    <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} className="w-full accent-[rgb(var(--pen))]" />
  </label>
);
}

export function WhatIf({ ov }: { ov: Overview }) {
  const [att, setAtt] = useState(Math.round(ov.score.components.attendance ?? 75));
  const [sgpa, setSgpa] = useState(ov.academics.sgpa ?? 7);
  const [eng, setEng] = useState(Math.round(ov.score.components.engagement ?? 60));
  const [resume, setResume] = useState(ov.placement.has_resume);
  const [skills, setSkills] = useState(Math.min(5, ov.placement.skills.length));
  const [certs, setCerts] = useState(Math.min(5, ov.placement.certifications.length));
  const [result, setResult] = useState<{ total: number | null; band: string; delta: number | null } | null>(null);
  const body = useMemo(() => ({ attendance: att, sgpa, engagement: eng, has_resume: resume, skills, certifications: certs }), [att, sgpa, eng, resume, skills, certs]);
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const r = await api.post<{ simulated: { total_score: number | null; risk_category: string }; delta: number | null }>(`/scoring/students/${ov.profile.id}/simulate`, body);
        setResult({ total: r.simulated.total_score, band: r.simulated.risk_category, delta: r.delta });
      } catch { /* keep last */ }
    }, 220);
    return () => clearTimeout(t);
  }, [body, ov.profile.id]);
  const band = (result?.band ?? ov.score.band) as keyof typeof BAND;
  return (
    <Sheet label="What-if" title="Move the dials, see the score">
      <div className="grid gap-6 md:grid-cols-[1fr_200px]">
        <div className="space-y-4">
          <Slider label="Attendance" value={att} set={setAtt} min={0} max={100} fmt={(v) => `${v}%`} />
          <Slider label="Next SGPA" value={sgpa} set={setSgpa} min={0} max={10} step={0.1} fmt={(v) => v.toFixed(1)} />
          <Slider label="LMS engagement" value={eng} set={setEng} min={0} max={100} fmt={(v) => `${v}`} />
          <div className="flex flex-wrap items-center gap-4 text-[13px]">
            <label className="flex items-center gap-2"><input type="checkbox" checked={resume} onChange={(e) => setResume(e.target.checked)} className="accent-[rgb(var(--pen))]" />Resume uploaded</label>
            <label className="flex items-center gap-2">Skills <input type="number" min={0} max={5} value={skills} onChange={(e) => setSkills(Math.max(0, Math.min(5, Number(e.target.value))))} className="w-14 rounded-sm bg-sheet-raised px-2 py-1 hairline" /></label>
            <label className="flex items-center gap-2">Certifications <input type="number" min={0} max={5} value={certs} onChange={(e) => setCerts(Math.max(0, Math.min(5, Number(e.target.value))))} className="w-14 rounded-sm bg-sheet-raised px-2 py-1 hairline" /></label>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center rounded-lg bg-paper-deep/60 p-5 text-center hairline">
          <div className="readout">Projected</div>
          <motion.div key={result?.total ?? 0} initial={{ scale: 0.94, opacity: 0.6 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.35, ease: EASE }}
            className="mt-2 font-display text-[3.4rem] leading-none tracking-[-0.05em]" style={{ color: BAND[band].ink }}>{num(result?.total)}</motion.div>
          <div className="mt-2"><BandChip band={band} size="sm" /></div>
          <div className="mt-2 text-xs"><Delta value={result?.delta ?? null} /> vs now</div>
        </div>
      </div>
      <p className="mt-4 flex items-center gap-1.5 text-xs text-graphite"><Info size={12} />Uses the exact scoring formula. Nothing is saved.</p>
    </Sheet>
  );
}
