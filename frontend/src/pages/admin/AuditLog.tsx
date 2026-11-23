import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { api, download, qs } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { Badge, Button, ErrorNote, PageHeader, Select, Sheet, Skeleton } from "@/ui/core";

interface Entry { id: number; created_at: string; user: string; user_role: string | null; action: string; entity_type: string | null; entity_id: string | null; ip_address: string | null; details: Record<string, unknown> }
const FILTERS = ["", "student_view", "consent", "meeting", "allocation", "import", "export", "user", "scores", "alert"];

export default function AuditLog() {
  const [action, setAction] = useState("");
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["audit", action], queryFn: () => api.get<Entry[]>(`/admin/audit-log${qs({ action, limit: 300 })}`) });
  return (
    <>
      <PageHeader eyebrow="DPDP accountability" title="Audit log" sub="Every profile view, consent change, import, export and allocation is recorded with who, when and from where."
        actions={<>
          <Select value={action} onChange={(e) => setAction(e.target.value)} className="w-48" aria-label="Filter">{FILTERS.map((f) => <option key={f} value={f}>{f ? f.replace("_", " ") : "All actions"}</option>)}</Select>
          <Button icon={<Download size={15} />} onClick={() => download("/admin/exports/audit-log", "mentoros_audit_log.csv")}>Export</Button>
        </>} />
      <Sheet pad={false}>
        {error ? <div className="p-4"><ErrorNote error={error} retry={() => refetch()} /></div> : isLoading ? <div className="space-y-2 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr className="border-b border-rule/10">{["When", "Who", "Action", "Target", "Details"].map((h) => <th key={h} className="readout px-4 py-2.5 text-left font-normal">{h}</th>)}</tr></thead>
              <tbody>{data?.map((e) => (
                <tr key={e.id} className="border-b border-rule/[0.07] align-top">
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-graphite">{dateTime(e.created_at)}</td>
                  <td className="px-4 py-2.5"><div>{e.user}</div>{e.user_role && <div className="text-xs text-graphite">{e.user_role}{e.ip_address ? ` · ${e.ip_address}` : ""}</div>}</td>
                  <td className="px-4 py-2.5"><Badge tone="pen">{e.action}</Badge></td>
                  <td className="px-4 py-2.5 font-mono text-xs">{e.entity_type ? `${e.entity_type}:${e.entity_id ?? "—"}` : "—"}</td>
                  <td className="max-w-[320px] truncate px-4 py-2.5 font-mono text-[11px] text-graphite">{Object.keys(e.details ?? {}).length ? JSON.stringify(e.details) : ""}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Sheet>
    </>
  );
}
