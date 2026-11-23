import { useMyOverview } from "@/lib/queries";
import { cn, num } from "@/lib/format";
import { ErrorNote, PageHeader, Reveal, Sheet } from "@/ui/core";
import { AttendanceTrend, SubjectAttendanceList } from "@/features/signal/SignalPanels";
import { PageSkeleton } from "./StudentHome";

export default function StudentAttendance() {
  const { data: ov, isLoading, error, refetch } = useMyOverview();
  if (isLoading) return <PageSkeleton />;
  if (error || !ov) return <ErrorNote error={error} retry={() => refetch()} />;
  const a = ov.attendance;
  const short = a.overall_pct != null && a.overall_pct < 75;
  return (
    <>
      <PageHeader eyebrow={`Attendance · ${ov.period}`} title="Every class, counted." sub="Exam eligibility needs 75% overall. These numbers update whenever the department imports attendance." />
      <div className="grid gap-4 lg:grid-cols-[1fr_1.6fr]">
        <Sheet tone="stack" label="Overall this term">
          <div className="flex items-end gap-2">
            <span className={cn("font-display text-[5.5rem] leading-[0.85] tracking-[-0.06em]", short && "text-critical")}>{num(a.overall_pct, 1)}</span>
            <span className="mb-2 text-2xl text-graphite">%</span>
          </div>
          <p className="mt-2 text-sm text-graphite">{a.attended} of {a.total} classes attended</p>
          <div className={cn("mt-6 rounded-md px-4 py-3 text-sm", short ? "bg-critical-wash text-critical" : "bg-thrive-wash text-thrive")}>
            {short ? <>Attend the next <b>{a.needed_for_75} classes</b> without missing one to get back to 75%.</> : <>You can miss up to <b>{a.can_skip} classes</b> overall and stay at 75%. Subject limits below still apply.</>}
          </div>
        </Sheet>
        <Sheet label="Week by week" title="Your attendance trace"><AttendanceTrend ov={ov} /></Sheet>
      </div>
      <Reveal className="mt-8">
        <h2 className="mb-4 font-display text-2xl">By subject</h2>
        <SubjectAttendanceList ov={ov} selfView />
      </Reveal>
    </>
  );
}
