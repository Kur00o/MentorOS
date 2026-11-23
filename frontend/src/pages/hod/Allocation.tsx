import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Minus, Plus, Shuffle, Wand2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { BAND, cn, num } from "@/lib/format";
import { STAFF_INVALIDATE, useAction } from "@/lib/queries";
import type { Band, StudentRow } from "@/lib/types";
import { Avatar, BandChip, Button, Empty, ErrorNote, PageHeader, Readout, Select, Sheet } from "@/ui/core";
import { Dialog } from "@/ui/overlay";
import { BandStrata } from "@/ui/charts";
import { PageSkeleton } from "@/pages/student/StudentHome";

interface MentorRow { id: number; name: string; email: string; avatar_url: string | null; designation: string; specialization: string | null; department: string; department_id: number; load: number; capacity: number; is_accepting: boolean; bands: Record<Band, number>; avg_score: number | null }
interface OverviewData { department_id: number | null; departments: { id: number; code: string; name: string }[]; mentors: MentorRow[]; pending: StudentRow[]; stats: { students: number; assigned: number; unassigned: number; capacity: number; free_seats: number; utilisation: number; at_risk_unassigned: number } }
interface Plan { dry_run: boolean; plan: { student_id: number; student_name: string; usn: string; band: Band; score: number | null; mentor_id: number; mentor_name: string }[]; allocated: number; skipped: number; message: string | null }

export default function Allocation() {
  const { me } = useAuth();
  const isAdmin = me?.role === "admin";
  const [dept, setDept] = useState<number | undefined>();
  const q = useQuery({ queryKey: ["allocation", dept ?? "own"], queryFn: () => api.get<OverviewData>(`/allocation/overview${dept ? `?department_id=${dept}` : ""}`) });
  const [plan, setPlan] = useState<Plan | null>(null);
  const [pick, setPick] = useState<Record<number, number>>({});
  const inv = [...STAFF_INVALIDATE, ["allocation"]];
  const preview = useAction(() => api.post<Plan>("/allocation/auto", { department_id: dept, dry_run: true }), { onSuccess: (r) => setPlan(r) });
  const commit = useAction(() => api.post<Plan>("/allocation/auto", { department_id: dept, dry_run: false }), { success: (r) => `Allocated ${(r as Plan).allocated} students · mentors notified`, invalidate: inv, onSuccess: () => setPlan(null) });
  const assign = useAction((v: { student_id: number; mentor_id: number }) => api.post("/allocation/assign", { ...v, reason: "Manual allocation from workspace" }), { success: "Assigned", invalidate: inv });
  const capacity = useAction((v: { id: number; max_mentees?: number; is_accepting?: boolean }) => api.patch(`/allocation/mentors/${v.id}`, v), { invalidate: inv });
  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !q.data) return <ErrorNote error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const mentors = d.mentors.filter((m) => m.capacity > 0 || m.load > 0);
  return (
    <>
      <PageHeader eyebrow="Mentor allocation" title="Match every student to a mentor." sub="Same department only, never over capacity, balanced load — and Coral and Amber students are always placed first."
        actions={<>
          {isAdmin && <Select value={dept ?? ""} onChange={(e) => setDept(Number(e.target.value) || undefined)} className="w-48" aria-label="Department"><option value="">All departments</option>{d.departments.map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}</Select>}
          <Button variant="ink" icon={<Wand2 size={15} />} disabled={!d.pending.length} loading={preview.isPending} onClick={() => preview.mutate(undefined)}>Auto-allocate</Button>
        </>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Readout label="Students" value={d.stats.students} />
        <Readout label="Waiting" value={d.stats.unassigned} tone={d.stats.unassigned ? "amber" : "green"} hint={`${d.stats.at_risk_unassigned} at risk`} />
        <Readout label="Free seats" value={d.stats.free_seats} tone="pen" />
        <Readout label="Capacity" value={d.stats.capacity} />
        <Readout label="Utilisation" value={d.stats.utilisation} digits={0} suffix="%" />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_1fr]">
        <section>
          <h2 className="mb-3 font-display text-2xl">Mentors</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {mentors.map((m) => {
              const pct = m.capacity ? Math.min(100, (m.load / m.capacity) * 100) : 100;
              return (
                <li key={m.id} className={cn("rounded-lg bg-sheet p-4 shadow-sheet hairline", !m.is_accepting && "opacity-70")}>
                  <div className="flex items-center gap-3">
                    <Avatar name={m.name} src={m.avatar_url} size={36} />
                    <div className="min-w-0 flex-1"><div className="truncate font-medium">{m.name}</div><div className="truncate text-xs text-graphite">{m.designation}{m.specialization ? ` · ${m.specialization}` : ""}</div></div>
                    {isAdmin && <span className="readout">{m.department}</span>}
                  </div>
                  <div className="mt-4 flex items-end justify-between">
                    <span className="font-display text-3xl tracking-[-0.04em]">{m.load}<span className="text-base text-graphite">/{m.capacity}</span></span>
                    <span className="flex items-center gap-1">
                      <button aria-label="Lower capacity" className="grid h-7 w-7 place-items-center rounded-md hairline hover:bg-ink/5" onClick={() => capacity.mutate({ id: m.id, max_mentees: m.capacity - 1 })}><Minus size={13} /></button>
                      <button aria-label="Raise capacity" className="grid h-7 w-7 place-items-center rounded-md hairline hover:bg-ink/5" onClick={() => capacity.mutate({ id: m.id, max_mentees: m.capacity + 1 })}><Plus size={13} /></button>
                    </span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink/[0.06]"><div className="h-full rounded-full transition-[width] duration-base ease-out" style={{ width: `${pct}%`, background: pct >= 100 ? BAND.amber.ink : "rgb(var(--ink))" }} /></div>
                  <div className="mt-3"><BandStrata counts={m.bands} height={6} showLegend={false} /></div>
                  <div className="mt-3 flex items-center justify-between text-xs text-graphite">
                    <span>avg {num(m.avg_score)}</span>
                    <label className="flex items-center gap-1.5"><input type="checkbox" checked={m.is_accepting} onChange={(e) => capacity.mutate({ id: m.id, is_accepting: e.target.checked })} className="accent-[rgb(var(--pen))]" />Accepting mentees</label>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
        <section>
          <h2 className="mb-3 font-display text-2xl">Waiting for a mentor</h2>
          <Sheet pad={false}>
            {d.pending.length ? (
              <ul className="divide-y divide-rule/10">
                {d.pending.map((s) => {
                  const options = mentors.filter((m) => m.department_id === s.department_id && m.is_accepting && m.load < m.capacity);
                  return (
                    <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <Avatar name={s.name} size={30} ring={s.band} />
                      <div className="min-w-0 flex-1"><Link to={`/${me?.role}/students/${s.id}`} className="block truncate font-medium hover:text-pen">{s.name}</Link><div className="font-mono text-[10px] text-graphite">{s.usn} · S{s.semester}</div></div>
                      <BandChip band={s.band} score={s.score} size="sm" showLabel={false} />
                      <Select value={pick[s.id] ?? ""} onChange={(e) => setPick({ ...pick, [s.id]: Number(e.target.value) })} className="h-8 w-44 text-xs" aria-label={`Mentor for ${s.name}`}>
                        <option value="">Choose mentor…</option>{options.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.load}/{m.capacity})</option>)}
                      </Select>
                      <Button size="sm" variant="ink" disabled={!pick[s.id]} loading={assign.isPending && assign.variables?.student_id === s.id} onClick={() => assign.mutate({ student_id: s.id, mentor_id: pick[s.id] })}>Assign</Button>
                    </li>
                  );
                })}
              </ul>
            ) : <Empty title="Everyone has a mentor" body="New students appear here as soon as they’re imported." icon={<Shuffle size={18} />} />}
          </Sheet>
        </section>
      </div>
      <Dialog open={!!plan} onOpenChange={(v) => !v && setPlan(null)} width={640} title="Allocation preview" description={plan ? `${plan.allocated} students will be matched${plan.skipped ? ` · ${plan.skipped} can’t be placed (capacity)` : ""}. Nothing changes until you confirm.` : undefined}
        footer={<><Button variant="ghost" onClick={() => setPlan(null)}>Cancel</Button><Button variant="ink" loading={commit.isPending} disabled={!plan?.allocated} onClick={() => commit.mutate(undefined)}>Confirm allocation</Button></>}>
        {plan?.message && <p className="mb-3 rounded-md bg-watch-wash px-3 py-2 text-sm text-watch">{plan.message}</p>}
        <ol className="space-y-1.5">
          {plan?.plan.map((p, i) => (
            <li key={p.student_id} className="grid grid-cols-[24px_1fr_auto_1fr] items-center gap-3 text-sm">
              <span className="tnum text-xs text-graphite">{i + 1}</span>
              <span className="flex items-center gap-2 truncate"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: BAND[p.band].ink }} />{p.student_name}</span>
              <span className="text-graphite">→</span>
              <span className="truncate font-medium">{p.mentor_name}</span>
            </li>
          ))}
        </ol>
      </Dialog>
    </>
  );
}
