import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CalendarPlus, ExternalLink, Mail, Phone, Shuffle, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { date, num, relative } from "@/lib/format";
import { STAFF_INVALIDATE, useAction, useStudentOverview } from "@/lib/queries";
import type { Meeting, Overview } from "@/lib/types";
import { useQuery } from "@tanstack/react-query";
import { Avatar, Badge, BandChip, Button, Empty, ErrorNote, Field, Readout, Reveal, Segmented, Select, Sheet, Textarea } from "@/ui/core";
import { Dialog } from "@/ui/overlay";
import { AlertList, AttendanceTrend, EngagementPanel, MarksPanel, PillarGrid, ScoreGaugeSheet, SemesterSgpa, SubjectAttendanceList, TraceSheet, WhatIf } from "@/features/signal/SignalPanels";
import { LogDialog, MeetingCard, ScheduleDialog } from "@/features/meetings/Meetings";
import { PageSkeleton } from "@/pages/student/StudentHome";

type Tab = "signal" | "attendance" | "academics" | "mentoring" | "placement" | "profile";

export const askCompanion = (q: string) => window.dispatchEvent(new CustomEvent("mentoros:ask", { detail: q }));

function AssignDialog({ ov, open, onOpenChange }: { ov: Overview; open: boolean; onOpenChange: (v: boolean) => void }) {
  const [mentor, setMentor] = useState<number | undefined>();
  const [reason, setReason] = useState("");
  const mentors = useQuery({
    queryKey: ["allocation", ov.profile.department.id],
    queryFn: () => api.get<{ mentors: { id: number; name: string; load: number; capacity: number; is_accepting: boolean }[] }>(`/allocation/overview?department_id=${ov.profile.department.id}`),
    enabled: open,
  });
  const save = useAction(() => api.post("/allocation/assign", { student_id: ov.profile.id, mentor_id: mentor, reason: reason || undefined }),
    { success: "Mentor assigned · both have been notified", invalidate: [...STAFF_INVALIDATE, ["allocation"]], onSuccess: () => onOpenChange(false) });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={ov.mentor ? "Reassign mentor" : "Assign a mentor"} description={`${ov.profile.name} · ${ov.profile.department.code}. Only mentors from the same department with free capacity can be chosen.`}
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="ink" disabled={!mentor} loading={save.isPending} onClick={() => save.mutate(undefined)}>Assign</Button></>}>
      <div className="space-y-4">
        <Field label="Mentor">
          <Select value={mentor ?? ""} onChange={(e) => setMentor(Number(e.target.value) || undefined)}>
            <option value="">Choose…</option>
            {mentors.data?.mentors.filter((m) => m.capacity > 0).map((m) => (
              <option key={m.id} value={m.id} disabled={m.load >= m.capacity || m.id === ov.mentor?.id}>{m.name} — {m.load}/{m.capacity}{m.load >= m.capacity ? " (full)" : ""}{m.id === ov.mentor?.id ? " (current)" : ""}</option>
            ))}
          </Select>
        </Field>
        <Field label="Reason (kept in allocation history)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className="min-h-[64px]" /></Field>
      </div>
    </Dialog>
  );
}

export default function StudentDetail() {
  const { id } = useParams();
  const { me } = useAuth();
  const { data: ov, isLoading, error, refetch } = useStudentOverview(id);
  const [tab, setTab] = useState<Tab>("signal");
  const [schedule, setSchedule] = useState(false);
  const [assign, setAssign] = useState(false);
  const [logging, setLogging] = useState<Meeting | null>(null);
  if (isLoading) return <PageSkeleton />;
  if (error || !ov) return <ErrorNote error={error} retry={() => refetch()} />;
  const p = ov.profile;
  const role = me!.role;
  const back = role === "mentor" ? "/mentor/mentees" : `/${role}/students`;
  const openResume = async () => { const r = await api.get<{ url: string }>(`/students/${p.id}/resume`); window.open(r.url, "_blank", "noopener"); };
  const meetings = [...ov.meetings.upcoming, ...ov.meetings.past].map((m) => ({ ...m, student_name: p.name, student_band: ov.score.band, mentor_name: ov.mentor?.name }));
  return (
    <>
      <Link to={back} className="link-draw mb-5 inline-flex items-center gap-1.5 text-sm text-graphite"><ArrowLeft size={14} />Back</Link>
      <header className="mb-6 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-center gap-5">
          <Avatar name={p.name} src={p.avatar_url} size={76} ring={ov.score.band} />
          <div>
            <div className="readout">{p.usn} · {p.department.code} · Semester {p.semester}{p.section ?? ""}{p.is_synthetic ? " · synthetic" : ""}</div>
            <h1 className="mt-1 font-display text-hero">{p.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <BandChip band={ov.score.band} score={ov.score.total} />
              <span className="text-graphite">Mentor: {ov.mentor?.name ?? <span className="text-watch">unassigned</span>}</span>
              <span className="text-graphite">· last login {relative(p.last_login_at)}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="soft" icon={<Sparkles size={15} />} onClick={() => askCompanion(`Brief me on ${p.usn}`)}>Brief me</Button>
          {(role === "mentor" || role === "hod") && ov.mentor && <Button variant="ink" icon={<CalendarPlus size={15} />} onClick={() => setSchedule(true)}>Schedule</Button>}
          {(role === "hod" || role === "admin") && <Button icon={<Shuffle size={15} />} onClick={() => setAssign(true)}>{ov.mentor ? "Reassign" : "Assign mentor"}</Button>}
          <a href={`mailto:${p.email}`}><Button variant="ghost" icon={<Mail size={15} />}>Email</Button></a>
        </div>
      </header>

      <Segmented layoutId="detail-tabs" value={tab} onChange={setTab} className="mb-6 max-w-full overflow-x-auto"
        options={[
          { value: "signal", label: "Signal" }, { value: "attendance", label: "Attendance" }, { value: "academics", label: "Academics" },
          { value: "mentoring", label: "Mentoring", count: meetings.length }, { value: "placement", label: "Placement" }, { value: "profile", label: "Profile" },
        ]} />

      {tab === "signal" && (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[340px_1fr]"><ScoreGaugeSheet ov={ov} compact /><TraceSheet ov={ov} title="Signal over the term" /></div>
          <PillarGrid ov={ov} />
          <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
            <Sheet label="Early warnings" title="Open alerts" action={<Link to={`/${role}/alerts`} className="text-xs text-pen hover:underline">All alerts</Link>}><AlertList alerts={ov.alerts} /></Sheet>
            <WhatIf ov={ov} />
          </div>
        </div>
      )}
      {tab === "attendance" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Readout label="Overall" value={ov.attendance.overall_pct} digits={1} suffix="%" tone={ov.attendance.overall_pct != null && ov.attendance.overall_pct < 75 ? "coral" : "green"} />
            <Readout label="Classes" value={ov.attendance.attended} hint={`of ${ov.attendance.total}`} />
            <Readout label="Needed for 75%" value={ov.attendance.needed_for_75} />
            <Readout label="Margin" value={ov.attendance.can_skip} hint="classes that can be missed" />
          </div>
          <Sheet label="Weekly" title="Attendance trace"><AttendanceTrend ov={ov} /></Sheet>
          <SubjectAttendanceList ov={ov} />
        </div>
      )}
      {tab === "academics" && (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
            <Sheet label="Results" title={`SGPA ${num(ov.academics.sgpa, 2)} · CGPA ${num(ov.academics.cgpa, 2)}`}><SemesterSgpa ov={ov} /></Sheet>
            <Sheet label="LMS" title="Engagement"><EngagementPanel ov={ov} /></Sheet>
          </div>
          <MarksPanel ov={ov} />
        </div>
      )}
      {tab === "mentoring" && (
        <div className="space-y-3">
          {meetings.length ? meetings.map((m) => <Reveal key={m.id}><MeetingCard m={m} perspective="staff" onLog={setLogging} /></Reveal>)
            : <Sheet><Empty title="No meetings yet" body="Schedule the first conversation." action={ov.mentor && role !== "admin" ? <Button variant="ink" onClick={() => setSchedule(true)}>Schedule</Button> : undefined} /></Sheet>}
        </div>
      )}
      {tab === "placement" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Sheet label="Readiness" title={`${num(ov.score.components.placement, 0)}/100 · ${ov.placement.status.replace("_", " ")}`}
            action={ov.placement.resume_available ? <Button size="sm" icon={<ExternalLink size={13} />} onClick={openResume}>Resume</Button> : <Badge tone="watch">No resume</Badge>}>
            <div className="readout mb-2">Skills</div>
            <div className="flex flex-wrap gap-1.5">{ov.placement.skills.map((s) => <Badge key={s}>{s}</Badge>)}{!ov.placement.skills.length && <span className="text-sm text-graphite">None listed</span>}</div>
            <div className="readout mb-2 mt-4">Certifications</div>
            <div className="flex flex-wrap gap-1.5">{ov.placement.certifications.map((s) => <Badge key={s} tone="pen">{s}</Badge>)}{!ov.placement.certifications.length && <span className="text-sm text-graphite">None listed</span>}</div>
            <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
              <div><div className="readout">Internships</div><div className="font-display text-2xl">{ov.placement.internships}</div></div>
              <div><div className="readout">Mock tests</div><div className="font-display text-2xl">{ov.placement.mock_tests_taken}</div></div>
              <div><div className="readout">Aptitude</div><div className="font-display text-2xl">{num(ov.placement.aptitude_score, 0)}</div></div>
            </div>
          </Sheet>
          <Sheet label="Drive" title="Applications">
            {ov.placement.offers.length ? (
              <ul className="divide-y divide-rule/10">{ov.placement.offers.map((o) => (
                <li key={o.id} className="flex items-center gap-3 py-2.5 text-sm"><span className="font-medium">{o.company}</span><span className="text-graphite">{o.role}</span><span className="ml-auto"><Badge tone={o.status === "accepted" ? "thrive" : o.status === "rejected" ? "critical" : "pen"}>{o.status}</Badge></span></li>
              ))}</ul>
            ) : <p className="text-sm text-graphite">No applications recorded.</p>}
          </Sheet>
        </div>
      )}
      {tab === "profile" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Sheet label="Student" title="Contact & background">
            <dl className="grid grid-cols-[140px_1fr] gap-y-2.5 text-sm">
              <dt className="text-graphite">Email</dt><dd className="truncate">{p.email}</dd>
              <dt className="text-graphite">Phone</dt><dd>{p.phone ?? "—"}</dd>
              <dt className="text-graphite">Home city</dt><dd>{p.home_city ?? "—"}{p.hostel_resident ? " · hostel" : ""}</dd>
              <dt className="text-graphite">Admitted</dt><dd>{p.admission_year ?? "—"}</dd>
              <dt className="text-graphite">Date of birth</dt><dd>{date(p.date_of_birth, { day: "numeric", month: "short", year: "numeric" })}{p.is_under_18 && <Badge tone="watch" className="ml-2">under 18</Badge>}</dd>
              <dt className="text-graphite">Interests</dt><dd>{p.interests.join(", ") || "—"}</dd>
            </dl>
            {p.bio && <p className="mt-4 border-t border-rule/10 pt-4 font-display text-[15px] italic">“{p.bio}”</p>}
          </Sheet>
          <Sheet label="Guardian" title={p.guardian_name ?? "Not recorded"}>
            <div className="space-y-2 text-sm">
              {p.guardian_phone && <a href={`tel:${p.guardian_phone}`} className="flex items-center gap-2"><Phone size={14} className="text-graphite" />{p.guardian_phone}</a>}
              {p.guardian_email && <a href={`mailto:${p.guardian_email}`} className="flex items-center gap-2"><Mail size={14} className="text-graphite" />{p.guardian_email}</a>}
            </div>
            <div className="readout mb-2 mt-6">Consent</div>
            <ul className="space-y-1.5 text-sm">{Object.entries(ov.consents).map(([k, c]) => (
              <li key={k} className="flex items-center justify-between"><span className="capitalize">{k}</span><Badge tone={c.consented ? "thrive" : "neutral"}>{c.consented ? "shared" : "withheld"}</Badge></li>
            ))}</ul>
          </Sheet>
        </div>
      )}

      <ScheduleDialog open={schedule} onOpenChange={setSchedule} studentId={p.id} studentName={p.name} />
      <AssignDialog ov={ov} open={assign} onOpenChange={setAssign} />
      <LogDialog meeting={logging} onOpenChange={(v) => !v && setLogging(null)} />
    </>
  );
}
