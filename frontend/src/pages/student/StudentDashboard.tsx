import { ArrowRight, BookOpen, CalendarDays, CheckCircle2, Sparkles, UserCircle2, XCircle } from "lucide-react";
import { getMyStudentProfile } from "@/api";
import { COMPONENT_META, RISK_META, componentValue } from "@/lib/score";
import { useAsync } from "@/lib/useAsync";
import { useAppStore } from "@/store/useAppStore";
import { Avatar } from "@/components/primitives/Avatar";
import { Button, EmptyState, GlassCard, LoadingState } from "@/components/primitives";
import { SectionHeading } from "@/components/SectionHeading";
import { SignalDisc } from "@/components/SignalDisc";
import { ScoreBreakdown } from "@/components/ScoreBreakdown";

const GUIDANCE: Record<string, string> = {
  attendance: "Attending more classes is your fastest lift — attendance is 35% of the score.",
  academic: "Clearing internals and any backlogs would raise your academic signal the most.",
  engagement: "Logging in regularly and submitting assignments on time lifts your engagement.",
  placement: "Completing your placement profile — resume, skills, certifications — is the quickest win.",
};

function semesterToYear(semester: number): string {
  const year = Math.ceil(semester / 2);
  const suffixes = ["", "1st", "2nd", "3rd", "4th"];
  return `${suffixes[year] ?? `${year}th`} Year`;
}

function attendanceColor(pct: number) {
  if (pct >= 75) return "text-signal-green";
  if (pct >= 60) return "text-signal-amber";
  return "text-signal-coral";
}



function SubjectCard({ subject }: { subject: { code: string; name: string; internal_marks: number; max_internal: number } }) {
  return (
    <GlassCard className="flex flex-col gap-3">
      <div>
        <p className="truncate text-caption font-semibold text-ink">{subject.name}</p>
        <p className="text-[11px] text-ink-soft">{subject.code}</p>
      </div>
      <div className="flex items-center justify-between border-t border-ink/8 pt-2 text-caption text-ink-soft">
        <span>Internals</span>
        <span className="font-mono tnum font-medium text-ink">
          {subject.internal_marks} / {subject.max_internal}
        </span>
      </div>
    </GlassCard>
  );
}

export default function StudentDashboard() {
  const student = useAsync(() => getMyStudentProfile(), []);
  const setCompanionOpen = useAppStore((s) => s.setCompanionOpen);

  if (student.loading) return <LoadingState label="Loading your profile…" />;
  if (student.error || !student.data) {
    return (
      <EmptyState
        icon={<UserCircle2 size={22} />}
        title="Profile not found"
        body={student.error ?? "Make sure you're signed in and your student profile exists."}
        action={<Button onClick={student.reload}>Try again</Button>}
      />
    );
  }

  const s = student.data;
  const risk = RISK_META[s.score.risk_category];
  const lowest = COMPONENT_META.reduce((min, m) =>
    componentValue(s.score, m.key) < componentValue(s.score, min.key) ? m : min,
  );
  const attendancePct = s.signals.attendance_pct;
  const subjects = s.signals.subjects;
  const pictureUrl = (s as any).profile_picture_url as string | null;

  return (
    <div className="flex flex-col gap-8">

      {/* ── Profile header ── */}
      <GlassCard tier="strong" className="flex flex-wrap items-center gap-5">
        {pictureUrl ? (
          <img
            src={pictureUrl}
            alt={s.name}
            className="h-16 w-16 rounded-full object-cover border-2 border-white shadow-sm shrink-0"
          />
        ) : (
          <Avatar name={s.name} hue={s.avatar_hue} size="lg" className="h-16 w-16 text-heading" />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-heading font-semibold text-ink">{s.name}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-ink-soft">
            <span className="flex items-center gap-1.5"><UserCircle2 size={13} /> {s.roll_no}</span>
            <span className="flex items-center gap-1.5"><BookOpen size={13} /> {s.department_id}</span>
            <span className="flex items-center gap-1.5">
              <CalendarDays size={13} /> {semesterToYear(s.semester)} · Semester {s.semester}
            </span>
          </div>
        </div>
        <span
          className="shrink-0 rounded-full px-3 py-1 text-caption font-medium"
          style={{ background: `color-mix(in srgb, ${risk.hex} 14%, white)`, color: risk.hex }}
        >
          {risk.label}
        </span>
      </GlassCard>

      {/* ── Attendance + score ── */}
      <div className="grid gap-5 sm:grid-cols-3">
        <GlassCard className="flex flex-col items-center justify-center gap-1 py-6 text-center">
          <span className={`font-mono tnum text-[40px] font-bold leading-none ${attendanceColor(attendancePct)}`}>
            {attendancePct.toFixed(1)}%
          </span>
          <p className="text-caption text-ink-soft">Overall attendance</p>
          <div className="mt-2 flex items-center gap-1.5 text-caption">
            {attendancePct >= 75
              ? <CheckCircle2 size={15} className="text-signal-green" />
              : <XCircle size={15} className="text-signal-coral" />}
            <span className={attendancePct >= 75 ? "text-signal-green" : "text-signal-coral"}>
              {attendancePct >= 75 ? "On track" : attendancePct >= 60 ? "At risk" : "Critical"}
            </span>
          </div>
        </GlassCard>

        <GlassCard tier="strong" className="flex flex-col items-center justify-center gap-3 py-6 sm:col-span-2">
          <div className="flex items-center gap-8">
            <SignalDisc breakdown={s.score} size="md" />
            <div className="min-w-0">
              <p className="text-caption text-ink-soft">Your Success Score</p>
              <p className="mt-0.5 font-mono tnum text-[36px] font-bold leading-none text-ink">
                {s.score.total_score.toFixed(0)}
              </p>
              <p className="mt-1 text-body font-medium" style={{ color: risk.hex }}>{risk.label}</p>
              <p className="mt-0.5 max-w-[180px] text-caption text-ink-soft">{risk.blurb}</p>
            </div>
          </div>
        </GlassCard>
      </div>

      {/* ── Subject cards ── */}
      {subjects.length > 0 && (
        <section className="flex flex-col gap-4">
          <SectionHeading
            title="Subject overview"
            description="Internal marks per subject this semester."
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {subjects.map((sub) => <SubjectCard key={sub.code} subject={sub} />)}
          </div>
          {attendancePct < 75 && (
            <div className="flex items-start gap-2 rounded-md bg-azure-200/35 p-3">
              <Sparkles size={16} className="mt-0.5 shrink-0 text-azure-600" />
              <p className="text-caption text-ink">
                <span className="font-medium">Attendance tip:</span>{" "}
                {attendancePct < 60
                  ? "Your overall attendance is critically low. Speak to your mentor as soon as possible."
                  : "You're close to the 75% minimum. Consistent attendance will keep you on track."}
              </p>
            </div>
          )}
        </section>
      )}

      {/* ── Score breakdown ── */}
      <section className="flex flex-col gap-4">
        <SectionHeading title="Score breakdown" description="Each component and its weight in your total score." />
        <GlassCard className="flex flex-col gap-4">
          <ScoreBreakdown breakdown={s.score} />
          <div className="flex items-start gap-2 rounded-md bg-azure-200/35 p-3">
            <Sparkles size={16} className="mt-0.5 shrink-0 text-azure-600" />
            <p className="text-caption text-ink">
              <span className="font-medium">Quickest win:</span> {GUIDANCE[lowest.key]}
            </p>
          </div>
        </GlassCard>
      </section>

      {/* ── Companion CTA ── */}
      <GlassCard className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-azure-200/60 text-azure-600">
            <Sparkles size={20} />
          </span>
          <div>
            <p className="text-body font-medium text-ink">Questions about your score?</p>
            <p className="text-caption text-ink-soft">Ask the AI Companion how each part works.</p>
          </div>
        </div>
        <Button onClick={() => setCompanionOpen(true)} iconRight={<ArrowRight size={16} />}>
          Open AI Companion
        </Button>
      </GlassCard>
    </div>
  );
}
