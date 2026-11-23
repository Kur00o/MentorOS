import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, KeyRound, MoreHorizontal, Search, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { api, qs } from "@/lib/api";
import { relative } from "@/lib/format";
import { useAction, useDepartments } from "@/lib/queries";
import type { Role } from "@/lib/types";
import { Avatar, Badge, Button, Empty, ErrorNote, Field, Input, PageHeader, Segmented, Select, Sheet, Skeleton } from "@/ui/core";
import { Dialog, DropMenu } from "@/ui/overlay";

interface UserRow { id: number; email: string; full_name: string; role: Role; department: string | null; department_id: number | null; is_active: boolean; has_login: boolean; last_login_at: string | null; usn: string | null; is_synthetic: boolean; avatar_url: string | null }
interface UsersPage { items: UserRow[]; total: number; page: number; page_size: number; counts: Partial<Record<Role, number>> }

function CreateUser({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: (pw: string | null, email: string) => void }) {
  const depts = useDepartments();
  const [f, setF] = useState({ email: "", full_name: "", role: "mentor" as Role, department_id: "", usn: "", semester: "1", section: "", designation: "", max_mentees: "20", provision_login: true });
  useEffect(() => { if (open) setF((x) => ({ ...x, email: "", full_name: "", usn: "" })); }, [open]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });
  const save = useAction(() => api.post<{ user: UserRow; temporary_password: string | null }>("/admin/users", {
    email: f.email, full_name: f.full_name, role: f.role, department_id: f.department_id ? Number(f.department_id) : undefined, provision_login: f.provision_login,
    ...(f.role === "student" ? { usn: f.usn, semester: Number(f.semester), section: f.section || undefined } : {}),
    ...(f.role === "mentor" || f.role === "hod" ? { designation: f.designation || undefined, max_mentees: Number(f.max_mentees) } : {}),
  }), { success: "Account created", invalidate: [["users"], ["institution"]], onSuccess: (r) => { onOpenChange(false); onCreated(r.temporary_password, r.user.email); } });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Add a person" description="Accounts are only ever created by admins. With sign-in access, a temporary password is shown once."
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="ink" loading={save.isPending} onClick={() => save.mutate(undefined)}>Create account</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Role" className="sm:col-span-2">
          <Segmented layoutId="new-role" value={f.role} onChange={(v) => setF({ ...f, role: v })} options={(["student", "mentor", "hod", "admin"] as Role[]).map((r) => ({ value: r, label: r === "hod" ? "HOD" : r[0].toUpperCase() + r.slice(1) }))} />
        </Field>
        <Field label="Full name"><Input value={f.full_name} onChange={set("full_name")} /></Field>
        <Field label="Email"><Input type="email" value={f.email} onChange={set("email")} /></Field>
        {f.role !== "admin" && (
          <Field label="Department" className="sm:col-span-2">
            <Select value={f.department_id} onChange={set("department_id")}><option value="">Choose…</option>{depts.data?.map((d) => <option key={d.id} value={d.id}>{d.code} · {d.name}</option>)}</Select>
          </Field>
        )}
        {f.role === "student" && (<>
          <Field label="USN"><Input value={f.usn} onChange={set("usn")} /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="Semester"><Select value={f.semester} onChange={set("semester")}>{[1, 2, 3, 4, 5, 6, 7, 8].map((s) => <option key={s}>{s}</option>)}</Select></Field><Field label="Section"><Input value={f.section} onChange={set("section")} maxLength={4} /></Field></div>
        </>)}
        {(f.role === "mentor" || f.role === "hod") && (<>
          <Field label="Designation"><Input value={f.designation} onChange={set("designation")} placeholder="Assistant Professor" /></Field>
          <Field label="Mentee capacity"><Input type="number" min={0} max={60} value={f.max_mentees} onChange={set("max_mentees")} /></Field>
        </>)}
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.provision_login} onChange={set("provision_login")} className="accent-[rgb(var(--pen))]" />Give sign-in access now (creates a Supabase Auth identity)</label>
      </div>
    </Dialog>
  );
}

export default function People() {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [role, setRole] = useState<"all" | Role>("all");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);
  useEffect(() => { const t = setTimeout(() => { setDebounced(q); setPage(1); }, 250); return () => clearTimeout(t); }, [q]);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["users", debounced, role, page], queryFn: () => api.get<UsersPage>(`/admin/users${qs({ q: debounced, role: role === "all" ? undefined : role, page, page_size: 40 })}`), placeholderData: (p) => p });
  const update = useAction((v: { id: number; body: Record<string, unknown> }) => api.patch(`/admin/users/${v.id}`, v.body), { success: "Saved", invalidate: [["users"]] });
  const provision = useAction((u: UserRow) => api.post<{ temporary_password: string | null; user: UserRow }>(`/admin/users/${u.id}/provision`, {}),
    { invalidate: [["users"]], onSuccess: (r) => r.temporary_password && setSecret({ email: r.user.email, password: r.temporary_password }) });
  const pages = data ? Math.ceil(data.total / data.page_size) : 1;
  return (
    <>
      <PageHeader eyebrow="Administration" title="People" sub="Create accounts, grant sign-in access, change roles and deactivate — every change is audited."
        actions={<Button variant="ink" icon={<UserPlus size={15} />} onClick={() => setCreating(true)}>Add person</Button>} />
      <Sheet pad={false}>
        <div className="flex flex-col gap-3 border-b border-rule/10 p-4 md:flex-row md:items-center">
          <div className="relative flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-graphite" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" className="pl-9" /></div>
          <Segmented layoutId="role-filter" value={role} onChange={(v) => { setRole(v); setPage(1); }}
            options={[{ value: "all", label: "All" }, ...(["student", "mentor", "hod", "admin"] as Role[]).map((r) => ({ value: r, label: r === "hod" ? "HOD" : r[0].toUpperCase() + r.slice(1), count: data?.counts[r] }))]} />
        </div>
        {error ? <div className="p-4"><ErrorNote error={error} retry={() => refetch()} /></div> : isLoading ? <div className="space-y-2 p-4">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12" />)}</div> : data?.items.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr className="border-b border-rule/10">{["Person", "Role", "Department", "Access", "Last sign-in", ""].map((h) => <th key={h} className="readout px-4 py-2.5 text-left font-normal">{h}</th>)}</tr></thead>
              <tbody>
                {data.items.map((u) => (
                  <tr key={u.id} className="border-b border-rule/[0.07] hover:bg-sheet-raised">
                    <td className="px-4 py-2.5"><div className="flex items-center gap-3"><Avatar name={u.full_name} src={u.avatar_url} size={30} /><div className="min-w-0"><div className="truncate font-medium">{u.full_name}{!u.is_active && <Badge tone="critical" className="ml-2">inactive</Badge>}</div><div className="truncate text-xs text-graphite">{u.email}{u.usn ? ` · ${u.usn}` : ""}</div></div></div></td>
                    <td className="px-4"><Badge tone={u.role === "admin" ? "ink" : u.role === "hod" ? "pen" : "neutral"}>{u.role}</Badge></td>
                    <td className="px-4 text-graphite">{u.department ?? "—"}</td>
                    <td className="px-4">{u.has_login ? <Badge tone="thrive">sign-in</Badge> : <span className="text-xs text-graphite">record only</span>}</td>
                    <td className="px-4 text-xs text-graphite">{relative(u.last_login_at)}</td>
                    <td className="px-4 text-right">
                      <DropMenu trigger={<button aria-label="Actions" className="grid h-8 w-8 place-items-center rounded-md hover:bg-ink/5"><MoreHorizontal size={16} /></button>} items={[
                        { label: u.has_login ? "Reset sign-in password" : "Give sign-in access", icon: <KeyRound size={14} />, onSelect: () => provision.mutate(u) },
                        ...(u.role !== "student" ? (["mentor", "hod", "admin"] as const).filter((r) => r !== u.role).map((r) => ({ label: `Make ${r === "hod" ? "HOD" : r}`, onSelect: () => update.mutate({ id: u.id, body: { role: r } }) })) : []),
                        "sep" as const,
                        { label: u.is_active ? "Deactivate" : "Reactivate", danger: u.is_active, onSelect: () => update.mutate({ id: u.id, body: { is_active: !u.is_active } }) },
                      ]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty title="Nobody matches" />}
        {data && pages > 1 && (
          <div className="flex items-center justify-between border-t border-rule/10 px-4 py-3 text-sm"><span className="text-graphite">{data.total} people · page {page}/{pages}</span>
            <div className="flex gap-2"><Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button></div></div>
        )}
      </Sheet>
      <CreateUser open={creating} onOpenChange={setCreating} onCreated={(pw, email) => pw && setSecret({ email, password: pw })} />
      <Dialog open={!!secret} onOpenChange={(v) => !v && setSecret(null)} title="Temporary password" description="Shown once. Share it securely — the person should change it after signing in."
        footer={<Button variant="ink" onClick={() => setSecret(null)}>Done</Button>}>
        <div className="rounded-md bg-paper-deep p-4 hairline"><div className="readout">{secret?.email}</div><div className="mt-1 flex items-center justify-between gap-3 font-mono text-lg">{secret?.password}
          <Button size="sm" icon={<Copy size={14} />} onClick={() => { navigator.clipboard.writeText(secret?.password ?? ""); toast.success("Copied"); }}>Copy</Button></div></div>
      </Dialog>
    </>
  );
}
