import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Bot, Database, KeyRound, Mail, Network, RefreshCw, Webhook } from "lucide-react";
import { api } from "@/lib/api";
import { relative } from "@/lib/format";
import { useAction } from "@/lib/queries";
import type { Integration } from "@/lib/types";
import { Badge, Button, ErrorNote, PageHeader, Select, Sheet } from "@/ui/core";
import { PageSkeleton } from "@/pages/student/StudentHome";
import { STATUS_STYLE } from "./AdminHome";

const ICON: Record<string, typeof Database> = { core: Database, identity: KeyRound, ai: Bot, messaging: Mail, institution: Network };
const CATEGORY: Record<string, string> = { core: "Platform", identity: "Identity", ai: "AI", messaging: "Messaging", institution: "Institution systems" };
const ENV_HINT: Record<string, string> = {
  google_oauth: "GOOGLE_OAUTH_ENABLED · VITE_ENABLE_GOOGLE_AUTH", llm: "LLM_PROVIDER · ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY / OLLAMA_BASE_URL",
  email: "RESEND_API_KEY or SMTP_HOST/USERNAME/PASSWORD", webhook: "NOTIFY_WEBHOOK_URL", erp: "ERP_API_URL · ERP_API_KEY", lms: "LMS_API_URL · LMS_API_KEY",
  attendance: "ATTENDANCE_API_URL · ATTENDANCE_API_KEY", placement: "PLACEMENT_API_URL · PLACEMENT_API_KEY", scheduler: "CRON_SECRET (Vercel Cron) or CELERY_BROKER_URL",
};

function Card({ i }: { i: Integration }) {
  const [dataset, setDataset] = useState(i.datasets?.[0] ?? "");
  const test = useAction(() => api.post<{ status: string; message: string }>(`/admin/integrations/${i.key}/test`), { success: (r) => `${i.label}: ${(r as { message: string }).message}`, invalidate: [["integrations"]] });
  const sync = useAction(() => { const fd = new FormData(); fd.append("dataset", dataset); return api.post<{ success_count: number; row_count: number }>(`/admin/integrations/${i.key}/sync`, fd); },
    { success: (r) => `Synced ${(r as { success_count: number }).success_count} rows`, invalidate: [["integrations"], ["students"]] });
  const s = STATUS_STYLE[i.status] ?? STATUS_STYLE.not_configured;
  const Icon = ICON[i.category] ?? Activity;
  return (
    <div className="flex flex-col rounded-lg bg-sheet p-5 shadow-sheet hairline">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-md bg-ink/[0.05] text-ink-soft"><Icon size={17} /></span>
        <div className="min-w-0 flex-1"><div className="font-medium">{i.label}</div><div className="text-xs text-graphite">{i.description ?? (i.required ? "Required" : "Optional")}</div></div>
        <Badge tone={s.tone}>{s.label}</Badge>
      </div>
      <p className="mt-3 text-[13px] text-ink-soft">{i.message}</p>
      {ENV_HINT[i.key] && i.status === "not_configured" && <p className="mt-2 font-mono text-[10px] leading-relaxed text-graphite">{ENV_HINT[i.key]}</p>}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        <Button size="xs" icon={<Activity size={12} />} loading={test.isPending} onClick={() => test.mutate(undefined)}>Test</Button>
        {i.datasets && (
          <>
            <Select value={dataset} onChange={(e) => setDataset(e.target.value)} className="h-7 w-32 text-xs">{i.datasets.map((d) => <option key={d}>{d}</option>)}</Select>
            <Button size="xs" variant="ink" icon={<RefreshCw size={12} />} disabled={i.status === "not_configured"} loading={sync.isPending} onClick={() => sync.mutate(undefined)}>Sync</Button>
          </>
        )}
      </div>
    </div>
  );
}

export default function Integrations() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["integrations"], queryFn: () => api.get<{ integrations: Integration[]; runs: { id: number; integration: string; action: string; status: string; message: string | null; created_at: string }[] }>("/admin/integrations") });
  if (isLoading) return <PageSkeleton />;
  if (error || !data) return <ErrorNote error={error} retry={() => refetch()} />;
  const groups = data.integrations.reduce<Record<string, Integration[]>>((a, i) => ({ ...a, [i.category]: [...(a[i.category] ?? []), i] }), {});
  return (
    <>
      <PageHeader eyebrow="Administration" title="Integrations" sub="Everything optional degrades gracefully — MentorOS keeps working with only Supabase configured. Secrets live in environment variables, never in the database." />
      {Object.entries(groups).map(([cat, items]) => (
        <section key={cat} className="mb-8">
          <h2 className="mb-3 font-display text-xl">{CATEGORY[cat] ?? cat}</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{items.map((i) => <Card key={i.key} i={i} />)}</div>
        </section>
      ))}
      <Sheet label="Log" title="Recent integration runs">
        {data.runs.length ? (
          <ul className="divide-y divide-rule/10 text-sm">{data.runs.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2"><Webhook size={13} className="text-graphite" /><span className="font-mono text-xs">{r.integration}:{r.action}</span><Badge tone={(STATUS_STYLE[r.status] ?? STATUS_STYLE.ok).tone}>{r.status}</Badge><span className="flex-1 truncate text-graphite">{r.message}</span><span className="readout !text-[9px]">{relative(r.created_at)}</span></li>
          ))}</ul>
        ) : <p className="text-sm text-graphite">No runs yet. Use “Test” on any integration.</p>}
      </Sheet>
    </>
  );
}
