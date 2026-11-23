import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarPlus, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { useAuth } from "@/lib/auth";
import { BAND, date, greeting, num, relative, RULE_LABEL, time } from "@/lib/format";
import { useMentorDashboard } from "@/lib/queries";
import type { Meeting, StudentRow } from "@/lib/types";
import { Avatar, Badge, BandChip, Button, Delta, EASE, Empty, ErrorNote, PageHeader, Readout, Reveal, Sheet } from "@/ui/core";
import { BandStrata, MicroTrace } from "@/ui/charts";
import { LogDialog, ScheduleDialog } from "@/features/meetings/Meetings";
import { PageSkeleton } from "@/pages/student/StudentHome";
import { askCompanion } from "@/pages/staff/StudentDetail";

function AttentionCard({ r, i, onSchedule }: { r: StudentRow; i: number; onSchedule: (r: StudentRow) => void }) {
  return (
    <motion.li initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.05 * i, ease: EASE }}
      className="group relative flex flex-col rounded-lg bg-sheet p-4 shadow-sheet hairline transition-shadow duration-fast hover:shadow-lift">
      <span className="absolute inset-y-3 left-0 w-[3px] rounded-r-full" style={{ background: BAND[r.band].ink }} />
      <div className="flex items-start gap-3">
        <Avatar name={r.name} src={r.avatar_url} size={38} ring={r.band} />
        <div className="min-w-0 flex-1">
          <Link to={`/mentor/students/${r.id}`} className="block truncate font-medium hover:text-pen">{r.name}</Link>
          <div className="font-mono text-[10px] text-graphite">{r.usn} · S{r.semester}</div>
        </div>
        <BandChip band={r.band} score={r.score} size="sm" showLabel={false} />
      </div>
      <div className="mt-3 flex items-end justify-between">
        <MicroTrace values={r.sparkline} band={r.band} width={120} height={30} />
        <div className="text-right text-xs"><Delta value={r.delta} /><div className="text-graphite">att {num(r.attendance_pct, 0)}%</div></div>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-rule/10 pt-3 text-xs text-graphite">
        <span>{r.high_alerts ? <span className="text-critical">{r.high_alerts} high alert{r.high_alerts > 1 ? "s" : ""}</span> : `${r.open_alerts} alert${r.open_alerts === 1 ? "" : "s"}`} · met {r.last_meeting_at ? relative(r.last_meeting_at) : "never"}</span>
        {r.next_meeting_at ? <Badge tone="pen">{date(r.next_meeting_at)}</Badge> : <button onClick={() => onSchedule(r)} className="font-medium text-pen hover:underline">Schedule</button>}
      </div>
    </motion.li>
  );
}

function Agenda({ meetings, onLog }: { meetings: Meeting[]; onLog: (m: Meeting) => void }) {
  const today = new Date().toDateString();
  const shown = meetings.slice(0, 7);
  const groups = shown.reduce<Record<string, Meeting[]>>((acc, m) => {
    const d = new Date(m.scheduled_at).toDateString();
    (acc[d] ||= []).push(m);
    return acc;
  }, {});
  if (!meetings.length) return <Empty title="Clear calendar" body="No sessions in the next few days." />;
  return (
    <>
      <ol className="space-y-4">
        {Object.entries(groups).map(([d, ms]) => (
          <li key={d}>
            <div className="readout mb-1.5">{d === today ? "Today" : new Date(d).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" })}</div>
            <ul className="space-y-1">
              {ms.map((m) => {
                const loggable = m.status === "scheduled" && new Date(m.scheduled_at).getTime() < Date.now() + 3600_000;
                return (
                  <li key={m.id} className="group grid grid-cols-[52px_1fr_auto] items-center gap-3 rounded-md px-2 py-2 hover:bg-paper-deep/60">
                    <span className="tnum font-mono text-[11px] text-graphite">{time(m.scheduled_at)}</span>
                    <span className="min-w-0">
                      <Link to={`/mentor/students/${m.student_id}`} className="flex items-center gap-1.5 truncate text-sm font-medium hover:text-pen">
                        {m.student_band && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: BAND[m.student_band].ink }} />}{m.student_name}
                      </Link>
                      <span className="block truncate text-xs text-graphite">{m.title}</span>
                    </span>
                    {m.status === "requested" ? <Badge tone="watch">request</Badge> : loggable ? <button onClick={() => onLog(m)} className="text-xs font-medium text-pen hover:underline">Log</button> : null}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>
      <Link to="/mentor/meetings" className="link-draw mt-4 inline-flex items-center gap-1 text-sm text-pen">{meetings.length > shown.length ? `${meetings.length - shown.length} more · ` : ""}Open meetings board <ArrowRight size={13} /></Link>
    </>
  );
}

export default function MentorToday() {
  const { me } = useAuth();
  const { data, isLoading, error, refetch } = useMentorDashboard();
  const [schedule, setSchedule] = useState<StudentRow | null | "new">(null);
  const [logging, setLogging] = useState<Meeting | null>(null);
  if (isLoading) return <PageSkeleton />;
  if (error || !data) return <ErrorNote error={error} retry={() => refetch()} />;
  const k = data.kpis;
  const todayCount = data.upcoming.filter((m) => new Date(m.scheduled_at).toDateString() === new Date().toDateString()).length;
  return (
    <>
      <PageHeader eyebrow={`${data.mentor.department} · ${data.mentor.designation}`} title={`${greeting()}, ${me?.full_name.replace(/^(Dr|Prof)\.\s*/, "").split(" ")[0]}.`}
        sub={<>{todayCount ? `${todayCount} session${todayCount > 1 ? "s" : ""} today` : "No sessions today"} · <span className="text-critical">{k.bands.coral} critical</span> · {k.bands.amber} on watch{k.pending_requests ? ` · ${k.pending_requests} request${k.pending_requests > 1 ? "s" : ""} to confirm` : ""}.</>}
        actions={<>
          <Button variant="soft" icon={<Sparkles size={15} />} onClick={() => askCompanion("Who needs attention?")}>Ask companion</Button>
          <Button variant="ink" icon={<CalendarPlus size={15} />} onClick={() => setSchedule("new")}>Schedule</Button>
        </>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Readout label="Mentees" value={k.mentees} hint={`capacity ${k.capacity}`} />
        <Readout label="Average score" value={k.avg_score} digits={1} tone={k.avg_score != null ? (k.avg_score >= 70 ? "green" : k.avg_score >= 50 ? "amber" : "coral") : undefined} />
        <Readout label="Flagged high" value={k.high_alerts} tone={k.high_alerts ? "coral" : "green"} hint={`students · ${k.open_alerts} open alerts`} />
        <Readout label="Met · 45 days" value={k.coverage_45d} suffix="%" tone="pen" hint={`${k.meetings_this_month} sessions this month`} />
        <Readout label="Open actions" value={k.open_action_items} hint="across all mentees" className="col-span-2 lg:col-span-1" />
      </div>

      <Sheet className="mt-4" label="Your roster" title="Band split"><BandStrata counts={k.bands} /></Sheet>

      <div className="mt-8 grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <section>
          <div className="mb-3 flex items-end justify-between">
            <div><div className="readout">Attention queue</div><h2 className="font-display text-2xl">Who needs you first</h2></div>
            <Link to="/mentor/mentees" className="link-draw inline-flex items-center gap-1 text-sm text-pen">All mentees <ArrowRight size={13} /></Link>
          </div>
          {data.attention.length ? (
            <ul className="grid gap-3 sm:grid-cols-2">{data.attention.map((r, i) => <AttentionCard key={r.id} r={r} i={i} onSchedule={setSchedule} />)}</ul>
          ) : <Sheet><Empty title="Everyone is on track" body="No Amber or Coral mentees right now." /></Sheet>}
          <Reveal className="mt-6">
            <Sheet label="Latest signals" title="New alerts">
              <ul className="divide-y divide-rule/10">
                {data.alerts.slice(0, 7).map((a) => (
                  <li key={a.id} className="flex items-start gap-3 py-2.5 text-sm">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: a.severity === "high" ? BAND.coral.ink : a.severity === "medium" ? BAND.amber.ink : "rgb(var(--graphite-light))" }} />
                    <div className="min-w-0 flex-1"><Link to={`/mentor/students/${a.student_id}`} className="font-medium hover:text-pen">{a.student_name}</Link> <span className="text-graphite">· {RULE_LABEL[a.rule]}</span><p className="truncate text-xs text-graphite">{a.detail}</p></div>
                  </li>
                ))}
              </ul>
              <Link to="/mentor/alerts" className="mt-3 inline-block text-sm text-pen hover:underline">Review all alerts</Link>
            </Sheet>
          </Reveal>
        </section>
        <aside className="space-y-6">
          <Sheet label="Agenda" title="Coming up"><Agenda meetings={data.upcoming} onLog={setLogging} /></Sheet>
          <Sheet label="Notebook" title="Recent session notes">
            <ul className="space-y-4">
              {data.recent_logs.map((m) => (
                <li key={m.id} className="text-sm">
                  <div className="flex items-center justify-between"><Link to={`/mentor/students/${m.student_id}`} className="font-medium hover:text-pen">{m.student_name}</Link><span className="readout">{date(m.scheduled_at)} · {time(m.scheduled_at)}</span></div>
                  <p className="mt-1 line-clamp-2 font-display text-[14.5px] italic text-ink-soft">“{m.log?.summary}”</p>
                </li>
              ))}
            </ul>
          </Sheet>
        </aside>
      </div>
      <ScheduleDialog open={schedule !== null} onOpenChange={(v) => !v && setSchedule(null)} studentId={schedule && schedule !== "new" ? schedule.id : undefined} studentName={schedule && schedule !== "new" ? schedule.name : undefined} />
      <LogDialog meeting={logging} onOpenChange={(v) => !v && setLogging(null)} />
    </>
  );
}
