import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Eye } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { BAND, cn, relative, RULE_LABEL } from "@/lib/format";
import { STAFF_INVALIDATE, useAction, useAlerts } from "@/lib/queries";
import type { Alert } from "@/lib/types";
import { Badge, BandChip, Button, Empty, ErrorNote, Field, PageHeader, Segmented, Sheet, Skeleton, Textarea } from "@/ui/core";
import { Dialog } from "@/ui/overlay";
import { BarList } from "@/ui/charts";

export default function AlertsBoard() {
  const { me } = useAuth();
  const [status, setStatus] = useState<"active" | "open" | "acknowledged" | "resolved">("active");
  const [severity, setSeverity] = useState<"all" | "high" | "medium" | "low">("all");
  const [resolving, setResolving] = useState<Alert | null>(null);
  const [note, setNote] = useState("");
  const { data, isLoading, error, refetch } = useAlerts({ status, severity: severity === "all" ? undefined : severity });
  const act = useAction((v: { id: number; status: string; note?: string }) => api.patch(`/alerts/${v.id}`, { status: v.status, note: v.note }),
    { success: "Alert updated", invalidate: STAFF_INVALIDATE, onSuccess: () => { setResolving(null); setNote(""); } });
  const byRule = Object.entries((data ?? []).reduce<Record<string, number>>((acc, a) => ({ ...acc, [a.rule]: (acc[a.rule] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
  return (
    <>
      <PageHeader eyebrow="Early warnings" title="Alerts" sub="Every alert shows the evidence that triggered it. Alerts resolve themselves when the condition clears." />
      <div className="mb-5 flex flex-wrap gap-3">
        <Segmented layoutId="alert-status" value={status} onChange={setStatus} options={[{ value: "active", label: "Active" }, { value: "open", label: "New" }, { value: "acknowledged", label: "Acknowledged" }, { value: "resolved", label: "Resolved" }]} />
        <Segmented layoutId="alert-sev" value={severity} onChange={setSeverity} options={[{ value: "all", label: "All" }, { value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }]} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <Sheet pad={false}>
          {error ? <div className="p-4"><ErrorNote error={error} retry={() => refetch()} /></div> : isLoading ? <div className="space-y-2 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div> : data?.length ? (
            <ul className="divide-y divide-rule/10">
              {data.map((a) => (
                <li key={a.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                  <span className={cn("hidden h-10 w-1 shrink-0 rounded-full sm:block", a.severity === "high" ? "bg-critical" : a.severity === "medium" ? "bg-watch" : "bg-graphite-light")} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to={`/${me?.role}/students/${a.student_id}`} className="font-medium hover:text-pen">{a.student_name}</Link>
                      <span className="font-mono text-[10px] text-graphite">{a.student_usn}</span>
                      {a.student_band && <BandChip band={a.student_band} score={a.student_score} size="sm" showLabel={false} />}
                      <Badge tone={a.severity === "high" ? "critical" : a.severity === "medium" ? "watch" : "neutral"}>{RULE_LABEL[a.rule] ?? a.rule}</Badge>
                      {a.status !== "open" && <Badge tone={a.status === "resolved" ? "thrive" : "pen"}>{a.status}</Badge>}
                    </div>
                    <p className="mt-1 text-[13px] text-graphite">{a.detail}</p>
                    {a.resolution_note && <p className="mt-1 text-xs italic text-ink-soft">Note: {a.resolution_note}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="readout mr-2 !text-[9px]">{relative(a.created_at)}</span>
                    {a.status === "open" && <Button size="xs" icon={<Eye size={13} />} onClick={() => act.mutate({ id: a.id, status: "acknowledged" })}>Acknowledge</Button>}
                    {a.status !== "resolved" && <Button size="xs" variant="ink" icon={<Check size={13} />} onClick={() => setResolving(a)}>Resolve</Button>}
                  </div>
                </li>
              ))}
            </ul>
          ) : <Empty title="No alerts here" body="The instrument is quiet for this filter." />}
        </Sheet>
        <Sheet label="Breakdown" title="By rule">
          <BarList rows={byRule.map(([r, n]) => ({ label: RULE_LABEL[r] ?? r, value: n }))} unit="" max={Math.max(1, ...byRule.map(([, n]) => n))} colorFor={() => BAND.amber.ink} />
        </Sheet>
      </div>
      <Dialog open={!!resolving} onOpenChange={(v) => !v && setResolving(null)} title="Resolve alert" description={resolving ? `${resolving.student_name} · ${RULE_LABEL[resolving.rule]}` : undefined}
        footer={<><Button variant="ghost" onClick={() => setResolving(null)}>Cancel</Button><Button variant="ink" loading={act.isPending} onClick={() => resolving && act.mutate({ id: resolving.id, status: "resolved", note: note || undefined })}>Resolve</Button></>}>
        <Field label="What was done?" hint="Saved with the alert and in the audit log."><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Met the student, attendance plan agreed" /></Field>
      </Dialog>
    </>
  );
}
