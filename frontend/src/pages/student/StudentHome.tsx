import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarPlus, Mail, MapPin } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { dateTime, greeting } from "@/lib/format";
import { useMyOverview } from "@/lib/queries";
import { Avatar, Button, ErrorNote, PageHeader, Reveal, Sheet, Skeleton } from "@/ui/core";
import { AlertList, PillarGrid, ScoreGaugeSheet, TraceSheet, WhatIf } from "@/features/signal/SignalPanels";
import { ActionItems, MeetingCard, ScheduleDialog } from "@/features/meetings/Meetings";

export function PageSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-12 w-72" />
      <div className="grid gap-4 lg:grid-cols-[360px_1fr]"><Skeleton className="h-[380px]" /><Skeleton className="h-[380px]" /></div>
      <div className="grid gap-3 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-36" />)}</div>
    </div>
  );
}

export default function StudentHome() {
  const { me } = useAuth();
  const { data: ov, isLoading, error, refetch } = useMyOverview();
  const [request, setRequest] = useState(false);
  if (isLoading) return <PageSkeleton />;
  if (error || !ov) return <ErrorNote error={error} retry={() => refetch()} />;
  const first = me?.full_name.split(" ")[0];
  const next = ov.meetings.upcoming[0];
  const actionsByMeeting = ov.meetings.past.filter((m) => m.log?.action_items.some((a) => !a.done)).slice(0, 2);
  return (
    <>
      <PageHeader eyebrow={`${ov.profile.department.code} · Semester ${ov.profile.semester} · ${ov.profile.usn}`} title={`${greeting()}, ${first}.`}
        sub={ov.score.band === "green" ? "Your trace is steady. Keep the habits that got you here." : ov.score.band === "insufficient_data" ? "Your score appears once attendance and results are imported." : "Your trace has dipped. Here’s exactly where the points are going — and what moves them back."}
        actions={<Button variant="ink" icon={<CalendarPlus size={15} />} onClick={() => setRequest(true)} disabled={!ov.mentor}>Request a meeting</Button>} />

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <ScoreGaugeSheet ov={ov} />
        <TraceSheet ov={ov} />
      </div>

      <Reveal className="mt-4"><PillarGrid ov={ov} /></Reveal>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        <Reveal><Sheet label="Early warnings" title="What needs attention"><AlertList alerts={ov.alerts} /></Sheet></Reveal>
        <Reveal delay={0.05}>
          <Sheet label="Your mentor" title={ov.mentor ? ov.mentor.name : "Not assigned yet"}>
            {ov.mentor ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Avatar name={ov.mentor.name} src={ov.mentor.avatar_url} size={44} />
                  <div className="text-sm">
                    <div className="text-ink-soft">{ov.mentor.designation}{ov.mentor.specialization ? ` · ${ov.mentor.specialization}` : ""}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-graphite">
                      {ov.mentor.office && <span className="inline-flex items-center gap-1"><MapPin size={11} />{ov.mentor.office}</span>}
                      <a href={`mailto:${ov.mentor.email}`} className="link-draw inline-flex items-center gap-1"><Mail size={11} />{ov.mentor.email}</a>
                    </div>
                  </div>
                </div>
                {next ? <MeetingCard m={{ ...next, mentor_name: ov.mentor.name }} perspective="student" compact /> : <p className="text-sm text-graphite">No session on the calendar. Request one any time.</p>}
                {actionsByMeeting.map((m) => (
                  <div key={m.id}>
                    <div className="readout">Open actions · {m.title} · {dateTime(m.scheduled_at)}</div>
                    <ActionItems meetingId={m.id} items={m.log!.action_items} />
                  </div>
                ))}
                <Link to="/student/meetings" className="link-draw inline-flex items-center gap-1 text-sm text-pen">All mentoring notes <ArrowRight size={13} /></Link>
              </div>
            ) : <p className="text-sm text-graphite">Your HOD allocates mentors — at-risk students are matched first.</p>}
          </Sheet>
        </Reveal>
      </div>

      {ov.score.total != null && <Reveal className="mt-4"><WhatIf ov={ov} /></Reveal>}
      <ScheduleDialog open={request} onOpenChange={setRequest} request />
    </>
  );
}
