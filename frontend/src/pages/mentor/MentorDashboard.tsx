import { useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  ClipboardCheck,
  ListChecks,
  Users,
  Video,
} from "lucide-react";
import type { MentorRosterItem } from "@/types";
import { getMe, getMentorDashboard, getMentorRoster } from "@/api";
import { RISK_META } from "@/lib/score";
import { useAsync } from "@/lib/useAsync";
import { formatDate, formatTime } from "@/lib/utils";
import { Avatar, Button, EmptyState, LoadingState } from "@/components/primitives";
import { SectionHeading } from "@/components/SectionHeading";
import { StatTile } from "@/components/StatTile";
import { RosterTable } from "@/features/mentor/RosterTable";
import { ScheduleMeetingModal } from "@/features/mentor/ScheduleMeetingModal";
import { LogMeetingModal } from "@/features/mentor/LogMeetingModal";

function avatarHue(studentId: number): number {
  return 200 + ((studentId * 37) % 150);
}

export default function MentorDashboard() {
  const me = useAsync(() => getMe(), []);
  const roster = useAsync(() => getMentorRoster(), []);
  const stats = useAsync(() => getMentorDashboard(), []);

  const [scheduleFor, setScheduleFor] = useState<MentorRosterItem | null>(null);
  const [logFor, setLogFor] = useState<MentorRosterItem | null>(null);

  if (roster.loading || stats.loading) return <LoadingState label="Loading your roster…" />;

  if (roster.error || !roster.data) {
    return (
      <EmptyState
        icon={<AlertTriangle size={22} />}
        title="We couldn't load your roster"
        body={roster.error ?? "Unable to load mentees. Please try again."}
        action={<Button onClick={roster.reload}>Try again</Button>}
      />
    );
  }

  const rows = roster.data;
  const summary = stats.data;
  const openItems = rows.reduce((sum, r) => sum + r.open_action_items, 0);

  function refresh() {
    roster.reload();
    stats.reload();
  }

  const upcoming = rows
    .filter((r) => r.next_meeting)
    .sort(
      (a, b) =>
        new Date(a.next_meeting!.scheduled_for).getTime() -
        new Date(b.next_meeting!.scheduled_for).getTime(),
    );

  const firstName = me.data?.full_name?.split(" ").slice(-1)[0] ?? "there";

  return (
    <div className="flex flex-col gap-8">
      <SectionHeading
        id="roster"
        title="Mentee roster"
        description={`${rows.length} students assigned to you — sorted with the lowest signals first.`}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Mentees"
          value={summary?.total_mentees ?? rows.length}
          icon={<Users size={18} />}
          sublabel="In your care this term"
        />
        <StatTile
          label="At risk"
          value={summary?.at_risk_count ?? 0}
          icon={<AlertTriangle size={18} />}
          accent={RISK_META.coral.hex}
          sublabel="Need attention now"
        />
        <StatTile
          label="To monitor"
          value={summary?.needs_attention_count ?? 0}
          accent={RISK_META.amber.hex}
          sublabel="Worth a check-in"
        />
        <StatTile
          label="Open action items"
          value={openItems}
          icon={<ListChecks size={18} />}
          sublabel="Across logged meetings"
        />
      </div>

      <RosterTable
        rows={rows}
        onSchedule={(e) => setScheduleFor(e)}
        onLog={(e) => setLogFor(e)}
      />

      {/* Upcoming meetings */}
      <section className="flex flex-col gap-4">
        <SectionHeading
          id="meetings"
          title="Upcoming meetings"
          description="Everything you've scheduled with your mentees."
        />
        {upcoming.length === 0 ? (
          <EmptyState
            icon={<CalendarClock size={22} />}
            title="No meetings scheduled yet"
            body="Schedule your first check-in from the roster above — at-risk students are a good place to start."
          />
        ) : (
          <div className="glass-quiet divide-y divide-ink/8">
            {upcoming.map((e) => {
              const m = e.next_meeting!;
              return (
                <div key={m.id} className="flex flex-wrap items-center gap-3 p-4">
                  <Avatar name={e.full_name} hue={avatarHue(e.student_id)} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body font-medium text-ink">{e.full_name}</p>
                    <p className="font-mono tnum text-caption text-ink-soft">{e.usn}</p>
                  </div>
                  <div className="flex items-center gap-2 text-caption text-ink">
                    <CalendarClock size={15} className="text-ink-soft" />
                    <span className="font-mono tnum">
                      {formatDate(m.scheduled_for)} · {formatTime(m.scheduled_for)}
                    </span>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full border border-ink/8 bg-white/60 px-2.5 py-0.5 text-caption capitalize text-ink-soft">
                    {m.mode === "video" && <Video size={13} />}
                    {m.mode}
                  </span>
                  <Button size="sm" variant="secondary" iconLeft={<ClipboardCheck size={15} />} onClick={() => setLogFor(e)}>
                    Log
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {scheduleFor && (
        <ScheduleMeetingModal
          open
          onClose={() => setScheduleFor(null)}
          studentId={scheduleFor.student_id}
          studentName={scheduleFor.full_name}
          onScheduled={refresh}
        />
      )}
      {logFor && (
        <LogMeetingModal
          open
          onClose={() => setLogFor(null)}
          studentId={logFor.student_id}
          studentName={logFor.full_name}
          meetingId={logFor.next_meeting?.id}
          scheduledFor={logFor.next_meeting?.scheduled_for}
          onLogged={refresh}
        />
      )}

      <p className="sr-only">Mentor dashboard for {firstName}</p>
    </div>
  );
}
