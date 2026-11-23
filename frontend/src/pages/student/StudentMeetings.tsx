import { useState } from "react";
import { CalendarPlus } from "lucide-react";
import { useMyOverview } from "@/lib/queries";
import { Button, Empty, ErrorNote, PageHeader, Reveal, Sheet } from "@/ui/core";
import { MeetingCard, ScheduleDialog } from "@/features/meetings/Meetings";
import { PageSkeleton } from "./StudentHome";

export default function StudentMeetings() {
  const { data: ov, isLoading, error, refetch } = useMyOverview();
  const [request, setRequest] = useState(false);
  if (isLoading) return <PageSkeleton />;
  if (error || !ov) return <ErrorNote error={error} retry={() => refetch()} />;
  const name = ov.mentor?.name;
  return (
    <>
      <PageHeader eyebrow="Mentoring" title="Conversations that change the trace." sub={name ? `${ov.meetings.completed_count} completed sessions with ${name}.` : "You’ll see sessions here once a mentor is assigned."}
        actions={<Button variant="ink" icon={<CalendarPlus size={15} />} onClick={() => setRequest(true)} disabled={!ov.mentor}>Request a meeting</Button>} />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 font-display text-xl">Coming up</h2>
            {ov.meetings.upcoming.length ? <div className="space-y-3">{ov.meetings.upcoming.map((m) => <MeetingCard key={m.id} m={{ ...m, mentor_name: name }} perspective="student" />)}</div>
              : <Sheet><Empty title="Nothing scheduled" body="Request a session whenever you want to talk something through." /></Sheet>}
          </section>
          <section>
            <h2 className="mb-3 font-display text-xl">Notes from past sessions</h2>
            <div className="space-y-3">{ov.meetings.past.map((m, i) => <Reveal key={m.id} delay={Math.min(i, 5) * 0.04}><MeetingCard m={{ ...m, mentor_name: name }} perspective="student" /></Reveal>)}</div>
          </section>
        </div>
        <aside className="space-y-4">
          <Sheet tone="ruled" label="Open action items" title={`${ov.meetings.open_action_items.length} to do`}>
            {ov.meetings.open_action_items.length ? (
              <ul className="space-y-3 text-sm">{ov.meetings.open_action_items.map((a) => <li key={a.id} className="leading-snug"><span className="mr-2 text-pen">→</span>{a.text}<div className="text-xs text-graphite">from {a.meeting_title}{a.due ? ` · due ${new Date(a.due).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}</div></li>)}</ul>
            ) : <p className="text-sm text-graphite">All caught up.</p>}
          </Sheet>
        </aside>
      </div>
      <ScheduleDialog open={request} onOpenChange={setRequest} request />
    </>
  );
}
