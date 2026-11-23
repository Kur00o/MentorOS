import { useEffect, useRef, useState } from "react";
import { Camera, Lock, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { date } from "@/lib/format";
import { useAction, useMyOverview } from "@/lib/queries";
import type { Overview } from "@/lib/types";
import { Avatar, Badge, Button, ErrorNote, Field, Input, PageHeader, Sheet, Textarea, Toggle } from "@/ui/core";
import { PageSkeleton } from "./StudentHome";

const CONSENT_COPY = {
  academic: ["Academic records", "Include SGPA and internal marks in NAAC/NBA accreditation exports."],
  attendance: ["Attendance", "Include your attendance component in accreditation exports."],
  placement: ["Placement profile", "Let the placement cell view your resume and readiness profile."],
  wellness: ["Wellness notes", "Not configurable in this version. Wellness information is never shared."],
} as const;

function ProfileForm({ ov }: { ov: Overview }) {
  const p = ov.profile;
  const [f, setF] = useState({ phone: p.phone ?? "", bio: p.bio ?? "", home_city: p.home_city ?? "", guardian_name: p.guardian_name ?? "", guardian_phone: p.guardian_phone ?? "", guardian_email: p.guardian_email ?? "", interests: p.interests.join(", ") });
  useEffect(() => setF((x) => ({ ...x, bio: p.bio ?? "" })), [p.bio]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const save = useAction(() => api.patch("/students/me", { ...f, phone: f.phone || null, guardian_phone: f.guardian_phone || null, guardian_email: f.guardian_email || null, interests: f.interests.split(",").map((s) => s.trim()).filter(Boolean) }),
    { success: "Profile saved", invalidate: [["overview"]] });
  return (
    <Sheet label="About you" title="Profile">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name"><Input value={p.name} disabled /></Field>
        <Field label="Email"><Input value={p.email} disabled /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={set("phone")} placeholder="+91 …" /></Field>
        <Field label="Home city"><Input value={f.home_city} onChange={set("home_city")} /></Field>
        <Field label="A line about you" className="sm:col-span-2"><Textarea value={f.bio} onChange={set("bio")} maxLength={600} placeholder="What are you working on? What would help?" /></Field>
        <Field label="Interests" hint="Comma separated" className="sm:col-span-2"><Input value={f.interests} onChange={set("interests")} /></Field>
        <Field label="Guardian name"><Input value={f.guardian_name} onChange={set("guardian_name")} /></Field>
        <Field label="Guardian phone"><Input value={f.guardian_phone} onChange={set("guardian_phone")} /></Field>
        <Field label="Guardian email" className="sm:col-span-2"><Input value={f.guardian_email} onChange={set("guardian_email")} /></Field>
      </div>
      <Button className="mt-5" variant="ink" loading={save.isPending} onClick={() => save.mutate(undefined)}>Save changes</Button>
    </Sheet>
  );
}

export default function StudentProfile() {
  const { refreshMe, me } = useAuth();
  const { data: ov, isLoading, error, refetch } = useMyOverview();
  const fileRef = useRef<HTMLInputElement>(null);
  const avatar = useAction((file: File) => { const fd = new FormData(); fd.append("file", file); return api.post("/students/me/avatar", fd); },
    { success: "Photo updated", invalidate: [["overview"]], onSuccess: () => refreshMe() });
  const consent = useAction((v: { category: string; consented: boolean }) => api.patch(`/students/${ov!.profile.id}/consents`, v), { success: "Preference saved · logged for audit", invalidate: [["overview"]] });
  if (isLoading) return <PageSkeleton />;
  if (error || !ov) return <ErrorNote error={error} retry={() => refetch()} />;
  return (
    <>
      <PageHeader eyebrow="Profile & privacy" title="Your record, your say." sub="Edit your contact details and decide how your data is shared beyond mentoring." />
      <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
        <div className="space-y-4">
          <Sheet>
            <div className="flex items-center gap-5">
              <div className="relative">
                <Avatar name={ov.profile.name} src={me?.avatar_url ?? ov.profile.avatar_url} size={84} />
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) avatar.mutate(f); e.target.value = ""; }} />
                <button aria-label="Change photo" onClick={() => fileRef.current?.click()} className="absolute -bottom-1 -right-1 grid h-8 w-8 place-items-center rounded-full bg-ink text-paper shadow-lift"><Camera size={14} /></button>
              </div>
              <div>
                <div className="font-display text-2xl">{ov.profile.name}</div>
                <div className="text-sm text-graphite">{ov.profile.usn} · {ov.profile.department.name} · Semester {ov.profile.semester}{ov.profile.section ? ` · Section ${ov.profile.section}` : ""}</div>
                {ov.profile.is_synthetic && <Badge className="mt-2">Synthetic demo record</Badge>}
              </div>
            </div>
          </Sheet>
          <ProfileForm ov={ov} />
        </div>
        <Sheet tone="stack" label="DPDP Act 2023" title="Data sharing consent">
          <p className="text-sm text-graphite">Your mentor and HOD always see your records for institutional mentoring. These switches control accreditation exports and sharing outside the department.</p>
          {ov.profile.is_under_18 && <div className="mt-4 flex items-start gap-2 rounded-md bg-watch-wash px-3 py-2.5 text-sm text-watch"><Lock size={15} className="mt-0.5" />You’re under 18, so verifiable parental consent is required. Contact the admin office to change these.</div>}
          <ul className="mt-5 divide-y divide-rule/10">
            {(Object.keys(CONSENT_COPY) as (keyof typeof CONSENT_COPY)[]).map((k) => {
              const c = ov.consents[k];
              return (
                <li key={k} className="flex items-start gap-4 py-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 font-medium">{CONSENT_COPY[k][0]}{c.locked && <Lock size={12} className="text-graphite" />}</div>
                    <p className="mt-0.5 text-[13px] text-graphite">{CONSENT_COPY[k][1]}</p>
                    {c.decided_at && <p className="readout mt-1 !text-[9px]">Notice v{c.notice_version} · decided {date(c.decided_at, { day: "numeric", month: "short", year: "numeric" })}</p>}
                  </div>
                  <Toggle label={CONSENT_COPY[k][0]} checked={c.consented} disabled={c.locked || consent.isPending} onChange={(v) => consent.mutate({ category: k, consented: v })} />
                </li>
              );
            })}
          </ul>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-graphite"><ShieldCheck size={13} />Every change is time-stamped and written to the audit log.</p>
        </Sheet>
      </div>
    </>
  );
}
