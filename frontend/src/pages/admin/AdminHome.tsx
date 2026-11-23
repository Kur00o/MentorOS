import { Link } from "react-router-dom";
import { ArrowRight, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { BAND, cn, num, relative } from "@/lib/format";
import { useInstitution } from "@/lib/queries";
import { Badge, Button, EASE, ErrorNote, PageHeader, Readout, Reveal, Sheet } from "@/ui/core";
import { BandStrata, CohortStrata } from "@/ui/charts";
import { PageSkeleton } from "@/pages/student/StudentHome";
import { askCompanion } from "@/pages/staff/StudentDetail";

export const STATUS_STYLE: Record<string, { tone: "thrive" | "pen" | "watch" | "critical" | "neutral"; label: string }> = {
  ok: { tone: "thrive", label: "Connected" }, configured: { tone: "pen", label: "Configured" }, not_configured: { tone: "neutral", label: "Not configured" },
  error: { tone: "critical", label: "Error" }, degraded: { tone: "watch", label: "Degraded" }, disabled: { tone: "neutral", label: "Disabled" },
};

export default function AdminHome() {
  const { data: d, isLoading, error, refetch } = useInstitution();
  if (isLoading) return <PageSkeleton />;
  if (error || !d) return <ErrorNote error={error} retry={() => refetch()} />;
  const users = Object.values(d.roles).reduce((a, b) => a + (b ?? 0), 0);
  const synthetic = d.batches.find((b) => b.kind === "synthetic");
  return (
    <>
      <PageHeader eyebrow="Institution" title="The whole instrument, at a glance." sub={`${d.kpis.students} active students across ${d.departments.length} departments · ${users} people · ${d.logins_provisioned} with sign-in access`}
        actions={<Button variant="soft" icon={<Sparkles size={15} />} onClick={() => askCompanion("System status")}>System status</Button>} />
      {synthetic && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-lg bg-watch-wash/70 px-4 py-3 text-sm text-watch">
          <Badge tone="watch">synthetic</Badge>
          This deployment runs on the <span className="font-mono">{synthetic.label}</span> demo dataset ({synthetic.students} students). {d.real_students} institutional student records.
          <Link to="/admin/data" className="ml-auto font-medium underline">Manage data</Link>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Readout label="Average score" value={d.kpis.avg_score} digits={1} delta={d.kpis.avg_delta} tone="pen" />
        <Readout label="At risk" value={d.kpis.at_risk} tone="amber" hint={`${d.kpis.coral} critical`} />
        <Readout label="High alerts" value={d.kpis.high_alerts} tone="coral" />
        <Readout label="Unassigned" value={d.kpis.unassigned} />
        <Readout label="Active · 7 days" value={d.active_7d} hint="people who signed in" className="col-span-2 lg:col-span-1" />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Sheet label="All departments" title="Cohort strata"><CohortStrata data={d.trend} height={230} /><div className="mt-4"><BandStrata counts={d.bands} /></div></Sheet>
        <Sheet label="Integrations" title="Systems" action={<Link to="/admin/integrations" className="text-xs text-pen hover:underline">Manage</Link>}>
          <ul className="space-y-2.5">
            {d.integrations.map((i) => (
              <li key={i.key} className="flex items-center gap-3 text-sm">
                <span className={cn("h-2 w-2 rounded-full", i.status === "ok" ? "bg-thrive" : i.status === "configured" ? "bg-pen" : i.status === "error" ? "bg-critical" : "bg-graphite-light")} />
                <span className="flex-1 truncate">{i.label}</span>
                <span className="text-xs text-graphite">{STATUS_STYLE[i.status]?.label}</span>
              </li>
            ))}
          </ul>
        </Sheet>
      </div>
      <h2 className="mb-3 mt-8 font-display text-2xl">Departments</h2>
      <div className="grid gap-3 md:grid-cols-3">
        {d.departments.map((dep, i) => (
          <motion.div key={dep.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06, duration: 0.7, ease: EASE }}>
            <Sheet tone="stack" label={`${dep.code} · HOD ${dep.hod ?? "unassigned"}`} title={dep.name}>
              <div className="flex items-end justify-between">
                <div><div className="readout">Avg score</div><div className="font-display text-[2.6rem] leading-none tracking-[-0.04em]" style={{ color: dep.avg_score != null ? BAND[dep.avg_score >= 70 ? "green" : dep.avg_score >= 50 ? "amber" : "coral"].ink : undefined }}>{num(dep.avg_score)}</div></div>
                <div className="text-right text-sm text-graphite">{dep.students} students<br />{dep.mentors} mentors · {dep.unassigned} waiting</div>
              </div>
              <div className="mt-4"><BandStrata counts={dep.bands} height={8} showLegend={false} /></div>
            </Sheet>
          </motion.div>
        ))}
      </div>
      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <Reveal><Sheet label="Activity" title="Recent actions" action={<Link to="/admin/audit" className="text-xs text-pen hover:underline">Audit log</Link>}>
          <ul className="space-y-2.5 text-sm">
            {d.activity.map((a) => (
              <li key={a.id} className="flex items-center gap-3"><span className="font-mono text-[11px] text-pen">{a.action}</span><span className="flex-1 truncate text-graphite">{a.user_name ?? "System"}{a.entity_type ? ` · ${a.entity_type} ${a.entity_id ?? ""}` : ""}</span><span className="readout !text-[9px]">{relative(a.created_at)}</span></li>
            ))}
          </ul>
        </Sheet></Reveal>
        <Reveal delay={0.05}><Sheet label="People" title="Accounts by role" action={<Link to="/admin/users" className="inline-flex items-center gap-1 text-xs text-pen hover:underline">Manage <ArrowRight size={12} /></Link>}>
          <div className="grid grid-cols-4 gap-3">
            {(["student", "mentor", "hod", "admin"] as const).map((r) => <div key={r}><div className="readout">{r}</div><div className="font-display text-3xl">{d.roles[r] ?? 0}</div></div>)}
          </div>
          <p className="mt-4 text-sm text-graphite">{d.logins_provisioned} people have sign-in access. Students without access still appear in mentoring and analytics.</p>
        </Sheet></Reveal>
      </div>
    </>
  );
}
