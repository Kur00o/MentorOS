import { useMemo, useState } from "react";
import { CalendarPlus } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useMeetings } from "@/lib/queries";
import type { Meeting } from "@/lib/types";
import { Button, Empty, ErrorNote, PageHeader, Reveal, Segmented, Sheet, Skeleton } from "@/ui/core";
import { LogDialog, MeetingCard, ScheduleDialog } from "@/features/meetings/Meetings";

type View = "upcoming" | "requests" | "to_log" | "past";

export default function MeetingsBoard() {
  const { me } = useAuth();
  const [view, setView] = useState<View>("upcoming");
  const [schedule, setSchedule] = useState(false);
  const [logging, setLogging] = useState<Meeting | null>(null);
  const { data, isLoading, error, refetch } = useMeetings({ limit: 400 });
  const now = Date.now();
  const groups = useMemo(() => {
    const all = data ?? [];
    return {
      upcoming: all.filter((m) => m.status === "scheduled" && new Date(m.scheduled_at).getTime() >= now - 3600_000).sort((a, b) => +new Date(a.scheduled_at) - +new Date(b.scheduled_at)),
      requests: all.filter((m) => m.status === "requested"),
      to_log: all.filter((m) => m.status === "scheduled" && new Date(m.scheduled_at).getTime() < now + 3600_000 && !m.log),
      past: all.filter((m) => ["completed", "cancelled", "no_show"].includes(m.status)),
    };
  }, [data, now]);
  const list = groups[view];
  return (
    <>
      <PageHeader eyebrow="Mentoring" title={me?.role === "mentor" ? "Your meetings" : "Department meetings"} sub="Confirm requests, log sessions as they happen, and keep the record honest."
        actions={me?.role !== "admin" && <Button variant="ink" icon={<CalendarPlus size={15} />} onClick={() => setSchedule(true)}>Schedule</Button>} />
      <Segmented layoutId="meet-view" value={view} onChange={setView} className="mb-5"
        options={[{ value: "upcoming", label: "Upcoming", count: groups.upcoming.length }, { value: "requests", label: "Requests", count: groups.requests.length },
          ...(me?.role === "mentor" ? [{ value: "to_log" as View, label: "To log", count: groups.to_log.length }] : []), { value: "past", label: "History", count: groups.past.length }]} />
      {error ? <ErrorNote error={error} retry={() => refetch()} /> : isLoading ? <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div> : list.length ? (
        <div className="grid gap-3 lg:grid-cols-2">{list.slice(0, 120).map((m, i) => <Reveal key={m.id} delay={Math.min(i, 8) * 0.03}><MeetingCard m={m} perspective="staff" onLog={setLogging} /></Reveal>)}</div>
      ) : <Sheet><Empty title={view === "requests" ? "No pending requests" : view === "to_log" ? "Nothing waiting to be logged" : "Nothing here yet"} /></Sheet>}
      <ScheduleDialog open={schedule} onOpenChange={setSchedule} />
      <LogDialog meeting={logging} onOpenChange={(v) => !v && setLogging(null)} />
    </>
  );
}
