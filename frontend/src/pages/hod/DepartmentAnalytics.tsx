import { useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { BAND, PILLARS, cn, num, RULE_LABEL } from "@/lib/format";
import { STAFF_INVALIDATE, useAction, useDepartments, useDeptAnalytics } from "@/lib/queries";
import { Avatar, Button, Delta, ErrorNote, Meter, PageHeader, Readout, Reveal, Select, Sheet } from "@/ui/core";
import { BandHeatmap, BandStrata, BarList, CohortStrata, Funnel, Histogram, SignalTrace } from "@/ui/charts";
import { RosterTable } from "@/features/students/RosterTable";
import { PageSkeleton } from "@/pages/student/StudentHome";
import { askCompanion } from "@/pages/staff/StudentDetail";

export default function DepartmentAnalytics() {
  const { me } = useAuth();
  const isAdmin = me?.role === "admin";
  const depts = useDepartments(isAdmin);
  const [dept, setDept] = useState<number | undefined>(undefined);
  const { data: a, isLoading, error, refetch } = useDeptAnalytics(isAdmin ? dept : undefined);
  const recompute = useAction(() => api.post<{ count: number }>(`/admin/scores/recompute${isAdmin && dept ? `?department_id=${dept}` : ""}`), {
    success: (r) => `Recomputed ${(r as { count: number }).count} scores`, invalidate: STAFF_INVALIDATE,
  });
  if (isLoading) return <PageSkeleton />;
  if (error || !a) return <ErrorNote error={error} retry={() => refetch()} />;
  const k = a.kpis;
  const base = `/${me?.role}`;
  const avgTrace = a.trend.filter((t) => t.avg_score != null).map((t) => ({ x: t.week, y: t.avg_score }));
  return (
    <>
      <PageHeader eyebrow={`${a.department?.code ?? "Institution"} · ${a.period}`} title={a.department?.name ?? "All departments"}
        sub={<>{k.students} active students · {k.mentors} mentors · average score {num(k.avg_score)} <Delta value={k.avg_delta} className="text-sm" /></>}
        actions={<>
          {isAdmin && (
            <Select value={dept ?? ""} onChange={(e) => setDept(Number(e.target.value) || undefined)} className="w-48" aria-label="Department">
              <option value="">All departments</option>{depts.data?.map((d) => <option key={d.id} value={d.id}>{d.code} · {d.name}</option>)}
            </Select>
          )}
          <Button variant="soft" icon={<Sparkles size={15} />} onClick={() => askCompanion("Give me a department summary")}>Summarise</Button>
          <Button icon={<RefreshCw size={15} />} loading={recompute.isPending} onClick={() => recompute.mutate(undefined)}>Recompute</Button>
        </>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Readout label="Average score" value={k.avg_score} digits={1} delta={k.avg_delta} tone="pen" className="col-span-2" />
        <Readout label="At risk" value={k.at_risk} tone="amber" hint={`${k.coral} critical`} />
        <Readout label="Attendance" value={k.avg_attendance} digits={1} suffix="%" />
        <Readout label="Unassigned" value={k.unassigned} tone={k.unassigned ? "amber" : "green"} hint={<Link className="text-pen hover:underline" to={`${base}/allocation`}>Allocate →</Link>} />
        <Readout label="Met in 45 days" value={k.meeting_coverage} suffix="%" hint={`${k.high_alerts} high alerts open`} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Sheet label="Cohort strata" title="How the department moved, week by week" action={<span className="readout hidden sm:block">count of students per band</span>}>
          <CohortStrata data={a.trend} height={240} />
          <div className="mt-4"><BandStrata counts={a.bands} /></div>
        </Sheet>
        <Sheet label="Department signal" title="Average score trace">
          {avgTrace.length > 1 && <SignalTrace points={avgTrace} height={200} />}
          <div className="mt-5 grid grid-cols-2 gap-x-5 gap-y-3">
            {PILLARS.map((p) => (
              <div key={p.key}>
                <div className="mb-1 flex justify-between text-[13px]"><span className="text-ink-soft">{p.label}</span><span className="tnum font-medium">{num(a.components[p.key], 0)}</span></div>
                <Meter value={a.components[p.key]} />
              </div>
            ))}
          </div>
        </Sheet>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr_1fr]">
        <Reveal><Sheet label="Semester × band" title="Where risk concentrates"><BandHeatmap rows={a.semesters} /></Sheet></Reveal>
        <Reveal delay={0.05}><Sheet label="Distribution" title="Score histogram"><Histogram data={a.score_distribution} height={190} /></Sheet></Reveal>
        <Reveal delay={0.1}><Sheet label="Early warnings" title="Most common alerts">
          <BarList rows={a.alert_rules.slice(0, 6).map((r) => ({ label: RULE_LABEL[r.rule] ?? r.rule, value: r.count }))} unit="" max={Math.max(1, ...a.alert_rules.map((r) => r.count))} colorFor={() => BAND.amber.ink} />
        </Sheet></Reveal>
      </div>

      <Reveal className="mt-4">
        <Sheet label="Mentor workload" title="Load, coverage and outcomes" pad={false}>
          <div className="overflow-x-auto px-2 pb-3">
            <table className="w-full min-w-[720px] text-sm">
              <thead><tr className="border-b border-rule/10">{["Mentor", "Load", "Bands", "Avg score", "Δ", "Sessions 30d", "Coverage", "Alerts"].map((h) => <th key={h} className="readout px-3 py-2.5 text-left font-normal">{h}</th>)}</tr></thead>
              <tbody>
                {a.mentors.filter((m) => m.capacity > 0 || m.load > 0).map((m) => (
                  <tr key={m.id} className="border-b border-rule/[0.07]">
                    <td className="px-3 py-3"><div className="flex items-center gap-2.5"><Avatar name={m.name} src={m.avatar_url} size={28} /><div><div className="font-medium">{m.name}</div><div className="text-xs text-graphite">{m.designation}</div></div></div></td>
                    <td className="px-3"><div className="w-28"><div className="tnum mb-1 text-xs">{m.load}/{m.capacity}</div><Meter value={m.load} max={Math.max(1, m.capacity)} color={m.load >= m.capacity ? BAND.amber.ink : "rgb(var(--ink))"} height={5} /></div></td>
                    <td className="px-3"><div className="w-32"><BandStrata counts={m.bands} height={8} showLegend={false} /></div></td>
                    <td className="tnum px-3 font-medium">{num(m.avg_score)}</td>
                    <td className="px-3 text-xs"><Delta value={m.avg_delta} /></td>
                    <td className="tnum px-3">{m.meetings_30d}</td>
                    <td className={cn("tnum px-3", m.coverage < 50 && "text-critical")}>{m.coverage}%</td>
                    <td className="tnum px-3">{m.open_alerts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Sheet>
      </Reveal>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Reveal><Sheet label="Subject difficulty" title="Where students struggle">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="border-b border-rule/10">{["Subject", "Sem", "Avg marks", "< 40%", "Attendance", "< 75%"].map((h) => <th key={h} className="readout py-2 pr-3 text-left font-normal">{h}</th>)}</tr></thead>
              <tbody>{a.subjects.slice(0, 10).map((s) => (
                <tr key={s.subject_id} className="border-b border-rule/[0.07]">
                  <td className="py-2.5 pr-3"><div className="font-medium">{s.name}</div><div className="font-mono text-[10px] text-graphite">{s.code}{s.faculty ? ` · ${s.faculty}` : ""}</div></td>
                  <td className="pr-3">{s.semester}</td>
                  <td className={cn("tnum pr-3 font-medium", (s.avg_marks ?? 100) < 50 && "text-critical")}>{num(s.avg_marks, 0)}%</td>
                  <td className="tnum pr-3">{s.below_40}</td>
                  <td className={cn("tnum pr-3", (s.avg_attendance ?? 100) < 75 && "text-critical")}>{num(s.avg_attendance, 0)}%</td>
                  <td className="tnum pr-3">{s.attendance_shortage}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Sheet></Reveal>
        <Reveal delay={0.05}><Sheet label="Placement" title="Final-year funnel">
          <Funnel stages={a.placement.funnel} />
          <div className="mt-5 grid grid-cols-3 gap-3 border-t border-rule/10 pt-4 text-sm">
            <div><div className="readout">Resumes</div><div className="font-display text-2xl">{a.placement.with_resume}</div></div>
            <div><div className="readout">Avg offer</div><div className="font-display text-2xl">{num(a.placement.avg_ctc_lpa)}<span className="text-sm"> LPA</span></div></div>
            <div><div className="readout">Ready ≥60</div><div className="font-display text-2xl">{k.placement_ready}%</div></div>
          </div>
        </Sheet></Reveal>
      </div>

      <Reveal className="mt-4">
        <Sheet label="Attention" title="Lowest signals in the department" pad={false}>
          <RosterTable rows={a.attention} showMentor dense />
        </Sheet>
      </Reveal>
    </>
  );
}
