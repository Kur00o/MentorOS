import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarPlus, Check, ClipboardPen, MapPin, Phone, Plus, Trash2, Video, X } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { BAND, cn, dateTime, MODE_LABEL, relative, time } from "@/lib/format";
import { STAFF_INVALIDATE, useAction, useStudents } from "@/lib/queries";
import type { ActionItem, Meeting, MeetingMode } from "@/lib/types";
import { Badge, Button, Field, Input, Segmented, Select, Textarea } from "@/ui/core";
import { Dialog } from "@/ui/overlay";

const STATUS_TONE = { requested: "watch", scheduled: "pen", completed: "thrive", cancelled: "neutral", no_show: "critical" } as const;
const MODE_ICON = { in_person: MapPin, video: Video, phone: Phone };

export function MeetingCard({ m, perspective, onLog, compact }: { m: Meeting; perspective: "student" | "staff"; onLog?: (m: Meeting) => void; compact?: boolean }) {
  const { me } = useAuth();
  const Icon = MODE_ICON[m.mode];
  const d = new Date(m.scheduled_at);
  const upcoming = d.getTime() > Date.now() - 3600_000 && ["scheduled", "requested"].includes(m.status);
  const canLog = perspective === "staff" && me?.role !== "hod" && m.status === "scheduled" && d.getTime() < Date.now() + 3600_000 && !m.log;
  const confirm = useAction(() => api.patch(`/mentoring/meetings/${m.id}`, { status: "scheduled" }), { success: "Meeting confirmed", invalidate: STAFF_INVALIDATE });
  const cancel = useAction(() => api.patch(`/mentoring/meetings/${m.id}`, { status: "cancelled" }), { success: "Meeting cancelled", invalidate: STAFF_INVALIDATE });
  const noShow = useAction(() => api.patch(`/mentoring/meetings/${m.id}`, { status: "no_show" }), { success: "Marked as no-show", invalidate: STAFF_INVALIDATE });
  const other = perspective === "student" ? m.mentor_name : m.student_name;
  return (
    <article className={cn("group relative flex gap-4 rounded-lg bg-sheet p-4 shadow-sheet hairline", m.status === "cancelled" && "opacity-60")}>
      <div className={cn("flex w-14 shrink-0 flex-col items-center justify-center rounded-md py-2 text-center", upcoming ? "bg-pen-wash text-pen-deep" : "bg-paper-deep/70 text-ink-soft")}>
        <span className="font-mono text-[9px] uppercase tracking-[0.14em]">{d.toLocaleDateString("en-IN", { month: "short" })}</span>
        <span className="font-display text-2xl leading-none">{d.getDate()}</span>
        <span className="mt-0.5 font-mono text-[9px]">{time(m.scheduled_at)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium">{m.title}</h3>
          <Badge tone={STATUS_TONE[m.status]}>{m.status.replace("_", " ")}</Badge>
          {m.requested_by === "student" && m.status === "requested" && <Badge tone="watch">student request</Badge>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-graphite">
          {other && (perspective === "staff" && me ? (
            <Link to={`/${me.role}/students/${m.student_id}`} className="link-draw inline-flex items-center gap-1.5 text-ink-soft">
              {m.student_band && <span className="h-1.5 w-1.5 rounded-full" style={{ background: BAND[m.student_band].ink }} />}{other}
            </Link>
          ) : <span>with {other}</span>)}
          <span className="inline-flex items-center gap-1"><Icon size={12} />{MODE_LABEL[m.mode]}{m.location ? ` · ${m.location}` : ""}</span>
          <span>{m.duration_minutes} min</span>
          {upcoming && <span>{relative(m.scheduled_at)}</span>}
        </div>
        {m.agenda && !compact && <p className="mt-2 text-[13px] text-ink-soft">{m.agenda}</p>}
        {m.log && !compact && (
          <div className="mt-3 rounded-md bg-paper-deep/50 p-3 text-[13px] hairline">
            <p className="font-display text-[15px] italic leading-snug">“{m.log.summary}”</p>
            {!!m.log.topics.length && <div className="mt-2 flex flex-wrap gap-1">{m.log.topics.map((t) => <Badge key={t}>{t}</Badge>)}</div>}
            {!!m.log.action_items.length && <ActionItems meetingId={m.id} items={m.log.action_items} />}
            {m.log.private_notes && <p className="mt-2 border-t border-dashed border-rule/15 pt-2 text-xs text-graphite"><span className="readout mr-1">Private</span>{m.log.private_notes}</p>}
          </div>
        )}
        {(canLog || (perspective === "staff" && m.status === "requested") || (upcoming && m.status !== "cancelled")) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {canLog && onLog && <Button size="xs" variant="ink" icon={<ClipboardPen size={13} />} onClick={() => onLog(m)}>Log meeting</Button>}
            {perspective === "staff" && m.status === "requested" && <Button size="xs" variant="pen" icon={<Check size={13} />} loading={confirm.isPending} onClick={() => confirm.mutate(undefined)}>Confirm</Button>}
            {canLog && <Button size="xs" variant="ghost" loading={noShow.isPending} onClick={() => noShow.mutate(undefined)}>No-show</Button>}
            {upcoming && <Button size="xs" variant="ghost" icon={<X size={13} />} loading={cancel.isPending} onClick={() => { if (confirmCancel()) cancel.mutate(undefined); }}>Cancel</Button>}
          </div>
        )}
      </div>
    </article>
  );
}
const confirmCancel = () => window.confirm("Cancel this meeting? The other person will be notified.");

export function ActionItems({ meetingId, items }: { meetingId: number; items: ActionItem[] }) {
  const [local, setLocal] = useState(items);
  useEffect(() => setLocal(items), [items]);
  const toggle = useAction((v: { id: string; done: boolean }) => api.patch<{ action_items: ActionItem[] }>(`/mentoring/meetings/${meetingId}/actions/${v.id}`, { done: v.done }),
    { invalidate: [["overview"], ["mentor-dashboard"]], onSuccess: (r) => setLocal(r.action_items) });
  return (
    <ul className="mt-2.5 space-y-1.5">
      {local.map((a) => (
        <li key={a.id}>
          <label className="flex cursor-pointer items-start gap-2.5">
            <input type="checkbox" checked={a.done} onChange={(e) => { setLocal((l) => l.map((x) => (x.id === a.id ? { ...x, done: e.target.checked } : x))); toggle.mutate({ id: a.id, done: e.target.checked }); }}
              className="mt-0.5 h-4 w-4 accent-[rgb(var(--pen))]" />
            <span className={cn("text-[13px]", a.done && "text-graphite line-through")}>{a.text}{a.due && <span className="ml-1.5 text-[11px] text-graphite">due {new Date(a.due).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

function defaultSlot() {
  const d = new Date(Date.now() + 2 * 864e5);
  d.setHours(11, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ScheduleDialog({ open, onOpenChange, studentId, studentName, request }: { open: boolean; onOpenChange: (v: boolean) => void; studentId?: number; studentName?: string; request?: boolean }) {
  const [sid, setSid] = useState<number | undefined>(studentId);
  const [title, setTitle] = useState(request ? "Guidance session" : "Check-in");
  const [when, setWhen] = useState(defaultSlot());
  const [duration, setDuration] = useState(30);
  const [mode, setMode] = useState<MeetingMode>("in_person");
  const [location, setLocation] = useState("");
  const [agenda, setAgenda] = useState("");
  const roster = useStudents({ page_size: 200, sort: "name" }, open && !request && !studentId);
  useEffect(() => { if (open) { setSid(studentId); setWhen(defaultSlot()); } }, [open, studentId]);
  const save = useAction(
    () => api.post<Meeting>("/mentoring/meetings", { student_id: request ? undefined : sid, title, scheduled_at: new Date(when).toISOString(), duration_minutes: duration, mode, location: location || undefined, agenda: agenda || undefined }),
    { success: request ? "Request sent to your mentor" : "Meeting scheduled — the student has been notified", invalidate: STAFF_INVALIDATE, onSuccess: () => onOpenChange(false) },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={request ? "Request a meeting" : "Schedule a meeting"}
      description={request ? "Your mentor will confirm or suggest another time." : studentName ? `With ${studentName}` : "Pick a mentee and a time."}
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="ink" icon={<CalendarPlus size={15} />} loading={save.isPending} disabled={!request && !sid} onClick={() => save.mutate(undefined)}>{request ? "Send request" : "Schedule"}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {!request && !studentId && (
          <Field label="Student" className="sm:col-span-2">
            <Select value={sid ?? ""} onChange={(e) => setSid(Number(e.target.value) || undefined)}>
              <option value="">Choose a student…</option>
              {roster.data?.items.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.usn} · {BAND[s.band].label}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Title" className="sm:col-span-2"><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} /></Field>
        <Field label="Date & time"><Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
        <Field label="Duration">
          <Select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>{[15, 20, 30, 45, 60].map((d) => <option key={d} value={d}>{d} minutes</option>)}</Select>
        </Field>
        <Field label="Mode" className="sm:col-span-2">
          <Segmented layoutId="mode-seg" value={mode} onChange={setMode} options={(["in_person", "video", "phone"] as MeetingMode[]).map((m) => ({ value: m, label: MODE_LABEL[m] }))} />
        </Field>
        <Field label={mode === "video" ? "Link" : "Location"} className="sm:col-span-2"><Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder={mode === "video" ? "Meeting link" : "Cabin, room or block"} /></Field>
        <Field label={request ? "What would you like to discuss?" : "Agenda"} className="sm:col-span-2"><Textarea value={agenda} onChange={(e) => setAgenda(e.target.value)} maxLength={2000} /></Field>
      </div>
    </Dialog>
  );
}

const TOPICS = ["attendance", "internal assessments", "backlog plan", "career goals", "placement prep", "wellbeing", "time management", "project work"];
const MOODS = [["thriving", "Thriving"], ["steady", "Steady"], ["stressed", "Stressed"], ["struggling", "Struggling"]] as const;

export function LogDialog({ meeting, onOpenChange }: { meeting: Meeting | null; onOpenChange: (v: boolean) => void }) {
  const [summary, setSummary] = useState("");
  const [topics, setTopics] = useState<string[]>([]);
  const [actions, setActions] = useState<{ text: string; due: string }[]>([{ text: "", due: "" }]);
  const [mood, setMood] = useState<string>("steady");
  const [follow, setFollow] = useState("");
  const [priv, setPriv] = useState("");
  useEffect(() => { if (meeting) { setSummary(""); setTopics([]); setActions([{ text: "", due: "" }]); setMood("steady"); setFollow(""); setPriv(""); } }, [meeting]);
  const save = useAction(
    () => api.post(`/mentoring/meetings/${meeting!.id}/log`, {
      summary, topics, student_mood: mood, follow_up_on: follow || undefined, private_notes: priv || undefined,
      action_items: actions.filter((a) => a.text.trim().length >= 2).map((a) => ({ text: a.text.trim(), due: a.due || undefined })),
    }),
    { success: "Meeting logged — action items shared with the student", invalidate: STAFF_INVALIDATE, onSuccess: () => onOpenChange(false) },
  );
  return (
    <Dialog open={!!meeting} onOpenChange={onOpenChange} width={640} title="Log meeting" description={meeting ? `${meeting.title} · ${meeting.student_name ?? ""} · ${dateTime(meeting.scheduled_at)}` : undefined}
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="ink" loading={save.isPending} disabled={summary.trim().length < 10} onClick={() => save.mutate(undefined)}>Save log</Button></>}>
      <div className="space-y-5">
        <Field label="Summary" hint="The student sees this. At least 10 characters."><Textarea value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What did you discuss and agree?" /></Field>
        <div>
          <div className="mb-2 text-[13px] font-medium text-ink-soft">Topics</div>
          <div className="flex flex-wrap gap-1.5">
            {TOPICS.map((t) => (
              <button key={t} type="button" onClick={() => setTopics((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]))}
                className={cn("rounded-full px-3 py-1 text-xs transition-colors", topics.includes(t) ? "bg-ink text-paper" : "bg-ink/[0.05] text-ink-soft hover:bg-ink/10")}>{t}</button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 text-[13px] font-medium text-ink-soft">Action items</div>
          <div className="space-y-2">
            {actions.map((a, i) => (
              <div key={i} className="flex gap-2">
                <Input value={a.text} onChange={(e) => setActions((x) => x.map((y, j) => (j === i ? { ...y, text: e.target.value } : y)))} placeholder="e.g. Attend every OS lecture this week" />
                <Input type="date" value={a.due} onChange={(e) => setActions((x) => x.map((y, j) => (j === i ? { ...y, due: e.target.value } : y)))} className="w-40" />
                <button type="button" aria-label="Remove" onClick={() => setActions((x) => x.filter((_, j) => j !== i))} className="grid w-10 place-items-center rounded-md text-graphite hover:bg-ink/5"><Trash2 size={15} /></button>
              </div>
            ))}
            <Button size="xs" variant="ghost" icon={<Plus size={13} />} onClick={() => setActions((x) => [...x, { text: "", due: "" }])}>Add action</Button>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="How did the student seem?">
            <Segmented layoutId="mood-seg" value={mood} onChange={setMood} options={MOODS.map(([v, l]) => ({ value: v, label: l }))} className="flex-wrap" />
          </Field>
          <Field label="Follow up on"><Input type="date" value={follow} onChange={(e) => setFollow(e.target.value)} /></Field>
        </div>
        <Field label="Private note" hint="Only mentors, HODs and admins see this."><Textarea value={priv} onChange={(e) => setPriv(e.target.value)} className="min-h-[64px]" /></Field>
      </div>
    </Dialog>
  );
}
