import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { CircleAlert, CircleCheck, Download, FileSpreadsheet, RefreshCw, Trash2, UploadCloud } from "lucide-react";
import { api, download } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn, date, relative } from "@/lib/format";
import { STAFF_INVALIDATE, useAction } from "@/lib/queries";
import { Badge, Button, EASE, Field, Input, PageHeader, Reveal, Sheet } from "@/ui/core";
import { Dialog } from "@/ui/overlay";

interface Template { kind: string; columns: string[]; description: string }
interface ImportResult { kind: string; row_count: number; success_count: number; created: number; updated: number; error_count: number; error_log: { row: number; column: string; reason: string }[]; status: string; recomputed: number }
interface Job { id: number; kind: string; source: string; filename: string | null; row_count: number; success_count: number; status: string; created_at: string; created_by: string | null }
interface Batch { id: number; label: string; kind: string; description: string | null; created_at: string; students: number; users: number }

const KIND_LABEL: Record<string, string> = { students: "Student roster", attendance: "Attendance", marks: "Internal marks", results: "Semester results (SGPA)", lms: "LMS activity", placement: "Placement profiles" };

function Importer() {
  const [kind, setKind] = useState("attendance");
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const templates = useQuery({ queryKey: ["templates"], queryFn: () => api.get<Template[]>("/admin/imports/templates"), staleTime: Infinity });
  const run = useAction(() => { const fd = new FormData(); fd.append("file", file!); return api.post<ImportResult>(`/admin/imports/${kind}`, fd); }, {
    success: (r) => `${(r as ImportResult).success_count}/${(r as ImportResult).row_count} rows imported`, invalidate: [...STAFF_INVALIDATE, ["imports"], ["institution"]],
    onSuccess: (r) => { setResult(r); setFile(null); },
  });
  const t = templates.data?.find((x) => x.kind === kind);
  return (
    <Sheet label="Import" title="Bring institutional data in">
      <div className="flex flex-wrap gap-1.5">
        {(templates.data ?? []).map((x) => (
          <button key={x.kind} onClick={() => { setKind(x.kind); setResult(null); }}
            className={cn("rounded-full px-3 py-1.5 text-[13px] transition-colors", kind === x.kind ? "bg-ink text-paper" : "bg-ink/[0.05] text-ink-soft hover:bg-ink/10")}>{KIND_LABEL[x.kind] ?? x.kind}</button>
        ))}
      </div>
      {t && <p className="mt-3 text-sm text-graphite">{t.description}</p>}
      {t && <div className="mt-2 flex flex-wrap gap-1">{t.columns.map((c, i) => <code key={c} className={cn("rounded px-1.5 py-0.5 font-mono text-[10px]", i < 2 ? "bg-pen-wash text-pen-deep" : "bg-ink/[0.05] text-graphite")}>{c}</code>)}</div>}
      <label onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) setFile(f); }}
        className={cn("mt-5 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors", drag ? "border-pen bg-pen-wash/40" : "border-rule-strong hover:border-ink/30")}>
        <input ref={input} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        {file ? <FileSpreadsheet className="text-pen" /> : <UploadCloud className="text-graphite" />}
        <span className="mt-2 font-medium">{file ? file.name : "Drop a CSV here or click to choose"}</span>
        <span className="text-xs text-graphite">{file ? `${(file.size / 1024).toFixed(1)} KB` : "UTF-8 CSV, up to 8 MB. Bad rows are reported, not fatal."}</span>
      </label>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="ink" icon={<UploadCloud size={15} />} disabled={!file} loading={run.isPending} onClick={() => run.mutate(undefined)}>Import {KIND_LABEL[kind]?.toLowerCase()}</Button>
        <Button variant="ghost" icon={<Download size={15} />} onClick={() => download(`/admin/imports/templates/${kind}`, `mentoros_${kind}_template.csv`)}>Template</Button>
      </div>
      {result && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }} className="mt-5 rounded-lg bg-paper-deep/60 p-4 hairline">
          <div className="flex flex-wrap items-center gap-3">
            {result.error_count ? <CircleAlert className="text-watch" size={18} /> : <CircleCheck className="text-thrive" size={18} />}
            <span className="font-medium">{result.success_count} of {result.row_count} rows imported</span>
            <Badge tone="thrive">{result.created} new</Badge><Badge tone="pen">{result.updated} updated</Badge>
            <span className="text-xs text-graphite">{result.recomputed} scores recomputed</span>
          </div>
          {!!result.error_log.length && (
            <div className="mt-3 max-h-56 overflow-y-auto rounded-md bg-sheet hairline">
              <table className="w-full text-xs"><thead><tr className="border-b border-rule/10">{["Row", "Column", "Problem"].map((h) => <th key={h} className="readout px-3 py-2 text-left font-normal">{h}</th>)}</tr></thead>
                <tbody>{result.error_log.map((e, i) => <tr key={i} className="border-b border-rule/[0.06]"><td className="tnum px-3 py-1.5">{e.row}</td><td className="px-3 font-mono">{e.column}</td><td className="px-3 text-critical">{e.reason}</td></tr>)}</tbody></table>
            </div>
          )}
        </motion.div>
      )}
    </Sheet>
  );
}

function Provenance() {
  const [purge, setPurge] = useState(false);
  const [phrase, setPhrase] = useState("");
  const batches = useQuery({ queryKey: ["batches"], queryFn: () => api.get<Batch[]>("/admin/batches") });
  const go = useAction(() => api.post("/admin/batches/purge-synthetic", { confirm: phrase }), { success: "Synthetic data purged", invalidate: [["batches"], ["institution"], ["students"]], onSuccess: () => setPurge(false) });
  return (
    <Sheet label="Provenance" title="Data batches">
      <p className="text-sm text-graphite">Synthetic demo rows are tagged at the row level and can be removed in one step without touching institutional records.</p>
      <ul className="mt-4 space-y-2">
        {batches.data?.map((b) => (
          <li key={b.id} className="flex flex-wrap items-center gap-3 rounded-md bg-paper-deep/50 px-4 py-3 hairline">
            <Badge tone={b.kind === "synthetic" ? "watch" : "thrive"}>{b.kind}</Badge>
            <span className="font-mono text-xs">{b.label}</span>
            <span className="text-xs text-graphite">{b.students} students · {b.users} users · {date(b.created_at)}</span>
          </li>
        ))}
        {!batches.data?.length && <li className="text-sm text-graphite">No batches recorded.</li>}
      </ul>
      <Button className="mt-4" variant="ghost" icon={<Trash2 size={15} />} onClick={() => setPurge(true)}>Purge synthetic data…</Button>
      <Dialog open={purge} onOpenChange={setPurge} title="Purge synthetic data" description="Deletes every row tagged synthetic (including demo accounts). Requires an institutional admin account."
        footer={<><Button variant="ghost" onClick={() => setPurge(false)}>Cancel</Button><Button variant="danger" disabled={phrase !== "PURGE SYNTHETIC DATA"} loading={go.isPending} onClick={() => go.mutate(undefined)}>Purge</Button></>}>
        <Field label="Type PURGE SYNTHETIC DATA to confirm"><Input value={phrase} onChange={(e) => setPhrase(e.target.value)} /></Field>
      </Dialog>
    </Sheet>
  );
}

export default function DataReports() {
  const { me } = useAuth();
  const isAdmin = me?.role === "admin";
  const jobs = useQuery({ queryKey: ["imports"], queryFn: () => api.get<Job[]>("/admin/imports") });
  const recompute = useAction(() => api.post<{ count: number }>("/admin/scores/recompute"), { success: (r) => `Recomputed ${(r as { count: number }).count} scores and re-ran risk rules`, invalidate: STAFF_INVALIDATE });
  const exports = [
    { label: "NAAC / NBA accreditation export", sub: "Consent-aware component scores and mentoring activity", path: "/admin/exports/naac", file: "mentoros_naac_nba_export.csv" },
    { label: "Student register", sub: "Every student in scope with score, band, attendance and CGPA", path: "/admin/exports/students", file: "mentoros_students.csv" },
    { label: "At-risk report", sub: "Amber and Coral students only", path: "/admin/exports/students?band=amber,coral", file: "mentoros_at_risk.csv" },
    ...(isAdmin ? [{ label: "Audit log", sub: "Every sensitive action for DPDP accountability", path: "/admin/exports/audit-log", file: "mentoros_audit_log.csv" }] : []),
  ];
  return (
    <>
      <PageHeader eyebrow="Data & reports" title="In with the registers, out with the reports." sub="CSV imports and live connectors share one validated pipeline; every import recomputes affected scores and re-runs risk rules."
        actions={<Button icon={<RefreshCw size={15} />} loading={recompute.isPending} onClick={() => recompute.mutate(undefined)}>Recompute scores</Button>} />
      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Importer />
        <div className="space-y-4">
          <Sheet label="Export" title="Reports">
            <ul className="divide-y divide-rule/10">
              {exports.map((e) => (
                <li key={e.path} className="flex items-center gap-4 py-3">
                  <div className="min-w-0 flex-1"><div className="font-medium">{e.label}</div><div className="text-xs text-graphite">{e.sub}</div></div>
                  <Button size="sm" icon={<Download size={14} />} onClick={() => download(e.path, e.file)}>CSV</Button>
                </li>
              ))}
            </ul>
          </Sheet>
          <Sheet label="History" title="Recent imports">
            <ul className="space-y-2 text-sm">
              {jobs.data?.slice(0, 8).map((j) => (
                <li key={j.id} className="flex items-center gap-3">
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", j.status === "completed" ? "bg-thrive" : j.status === "partial" ? "bg-watch" : "bg-critical")} />
                  <span className="flex-1 truncate">{KIND_LABEL[j.kind] ?? j.kind} <span className="text-graphite">· {j.filename ?? j.source}</span></span>
                  <span className="tnum text-xs">{j.success_count}/{j.row_count}</span>
                  <span className="readout !text-[9px]">{relative(j.created_at)}</span>
                </li>
              ))}
              {!jobs.data?.length && <li className="text-graphite">No imports yet.</li>}
            </ul>
          </Sheet>
        </div>
      </div>
      {isAdmin && <Reveal className="mt-4"><Provenance /></Reveal>}
    </>
  );
}
