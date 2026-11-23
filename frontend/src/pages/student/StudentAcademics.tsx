import { useMyOverview } from "@/lib/queries";
import { ErrorNote, PageHeader, Readout, Reveal, Sheet } from "@/ui/core";
import { EngagementPanel, MarksPanel, SemesterSgpa } from "@/features/signal/SignalPanels";
import { PageSkeleton } from "./StudentHome";

export default function StudentAcademics() {
  const { data: ov, isLoading, error, refetch } = useMyOverview();
  if (isLoading) return <PageSkeleton />;
  if (error || !ov) return <ErrorNote error={error} retry={() => refetch()} />;
  const ac = ov.academics;
  return (
    <>
      <PageHeader eyebrow="Academics & engagement" title="The work behind the number." sub="Declared SGPA drives the Academic pillar. Internal marks don’t change the score — they warn you early." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Readout label="Latest SGPA" value={ac.sgpa} digits={2} tone="pen" />
        <Readout label="CGPA" value={ac.cgpa} digits={2} />
        <Readout label="Active backlogs" value={ac.active_backlogs} tone={ac.active_backlogs ? "coral" : "green"} />
        <Readout label="Academic pillar" value={ov.score.components.academic} digits={0} hint="SGPA × 10" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <Sheet label="Semester results" title="SGPA by semester"><SemesterSgpa ov={ov} /></Sheet>
        <Sheet label="LMS" title="Engagement this term"><EngagementPanel ov={ov} /></Sheet>
      </div>
      <Reveal className="mt-8">
        <h2 className="mb-4 font-display text-2xl">Internal assessments · {ov.period}</h2>
        {ov.academics.subjects.length ? <MarksPanel ov={ov} /> : <p className="text-sm text-graphite">No internal marks imported yet.</p>}
      </Reveal>
    </>
  );
}
