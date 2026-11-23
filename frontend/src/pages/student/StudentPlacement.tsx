import { useEffect, useRef, useState } from "react";
import { ExternalLink, FileUp, Plus, X } from "lucide-react";
import { api } from "@/lib/api";
import { cn, date, num } from "@/lib/format";
import { useAction, useMyOverview } from "@/lib/queries";
import type { Overview } from "@/lib/types";
import { Badge, Button, ErrorNote, Field, Input, Meter, PageHeader, Reveal, Select, Sheet } from "@/ui/core";
import { PageSkeleton } from "./StudentHome";

function TagEditor({ label, values, onChange, placeholder, max = 30 }: { label: string; values: string[]; onChange: (v: string[]) => void; placeholder: string; max?: number }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (v && !values.some((x) => x.toLowerCase() === v.toLowerCase()) && values.length < max) onChange([...values, v]);
    setDraft("");
  };
  return (
    <div>
      <div className="mb-2 text-[13px] font-medium text-ink-soft">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {values.map((v, i) => (
          <span key={v} className={cn("inline-flex items-center gap-1 rounded-full py-1 pl-3 pr-1 text-xs", i < 5 ? "bg-ink text-paper" : "bg-ink/[0.06] text-ink-soft")}>
            {v}<button aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))} className="grid h-4 w-4 place-items-center rounded-full hover:bg-white/20"><X size={11} /></button>
          </span>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} placeholder={placeholder} />
        <Button variant="outline" icon={<Plus size={15} />} onClick={add}>Add</Button>
      </div>
      <p className="mt-1.5 text-xs text-graphite">The first five count towards your score.</p>
    </div>
  );
}

function Editor({ ov }: { ov: Overview }) {
  const pl = ov.placement;
  const [skills, setSkills] = useState(pl.skills);
  const [certs, setCerts] = useState(pl.certifications);
  const [role, setRole] = useState(pl.target_role ?? "");
  const [status, setStatus] = useState(pl.status);
  const [linkedin, setLinkedin] = useState(pl.linkedin_url ?? "");
  const [github, setGithub] = useState(pl.github_url ?? "");
  useEffect(() => { setSkills(pl.skills); setCerts(pl.certifications); }, [pl.skills, pl.certifications]);
  const save = useAction(() => api.put<Overview>("/students/me/placement", {
    skills, certifications: certs, target_role: role || null, status, linkedin_url: linkedin || null, github_url: github || null,
  }), { success: (r) => `Saved · placement pillar now ${num((r as Overview).score.components.placement, 0)}`, invalidate: [["overview"]] });
  return (
    <Sheet label="Placement profile" title="Tell recruiters what you can do">
      <div className="space-y-6">
        <TagEditor label="Skills" values={skills} onChange={setSkills} placeholder="e.g. Python, SolidWorks, Verilog" />
        <TagEditor label="Certifications" values={certs} onChange={setCerts} placeholder="e.g. AWS Cloud Practitioner" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Target role"><Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Software Engineer" /></Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              {[["not_started", "Not started"], ["preparing", "Preparing"], ["applying", "Applying"], ["placed", "Placed"], ["higher_studies", "Higher studies"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
          <Field label="LinkedIn"><Input value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="https://linkedin.com/in/…" /></Field>
          <Field label="GitHub / portfolio"><Input value={github} onChange={(e) => setGithub(e.target.value)} placeholder="https://github.com/…" /></Field>
        </div>
        <Button variant="ink" loading={save.isPending} onClick={() => save.mutate(undefined)}>Save profile</Button>
      </div>
    </Sheet>
  );
}

export default function StudentPlacement() {
  const { data: ov, isLoading, error, refetch } = useMyOverview();
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = useAction((f: File) => { const fd = new FormData(); fd.append("file", f); return api.post("/students/me/resume", fd); },
    { success: "Resume uploaded · +40 on your placement pillar", invalidate: [["overview"]] });
  const viewResume = async () => { const r = await api.get<{ url: string }>("/students/me/resume"); window.open(r.url, "_blank", "noopener"); };
  if (isLoading) return <PageSkeleton />;
  if (error || !ov) return <ErrorNote error={error} retry={() => refetch()} />;
  const pl = ov.placement;
  const parts = [
    { label: "Resume", pts: pl.has_resume ? 40 : 0, max: 40 },
    { label: `Skills (${Math.min(5, pl.skills.length)}/5)`, pts: Math.min(5, pl.skills.length) * 8, max: 40 },
    { label: `Certifications (${Math.min(5, pl.certifications.length)}/5)`, pts: Math.min(5, pl.certifications.length) * 4, max: 20 },
  ];
  return (
    <>
      <PageHeader eyebrow="Placement readiness" title="The pillar you can move this week." sub="Resume, skills and certifications make up 15% of your Success Score — and they’re entirely in your hands." />
      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        <div className="space-y-4">
          <Sheet tone="stack" label="Placement pillar">
            <div className="font-display text-[4.5rem] leading-none tracking-[-0.06em]">{num(ov.score.components.placement, 0)}<span className="text-2xl text-graphite">/100</span></div>
            <ul className="mt-5 space-y-3">
              {parts.map((p) => (
                <li key={p.label}>
                  <div className="mb-1 flex justify-between text-[13px]"><span className="text-ink-soft">{p.label}</span><span className="tnum font-medium">{p.pts}/{p.max}</span></div>
                  <Meter value={p.pts} max={p.max} color="rgb(var(--pen))" />
                </li>
              ))}
            </ul>
          </Sheet>
          <Sheet label="Resume" title={pl.has_resume ? "On file" : "Not uploaded"}>
            <p className="text-sm text-graphite">PDF up to 5 MB. Only you, your mentor and (with your consent) the placement cell can open it.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ""; }} />
              <Button variant={pl.has_resume ? "outline" : "pen"} icon={<FileUp size={15} />} loading={upload.isPending} onClick={() => fileRef.current?.click()}>{pl.has_resume ? "Replace resume" : "Upload resume"}</Button>
              {pl.resume_available && <Button variant="ghost" icon={<ExternalLink size={14} />} onClick={viewResume}>View</Button>}
            </div>
          </Sheet>
        </div>
        <Editor ov={ov} />
      </div>
      {pl.offers.length > 0 && (
        <Reveal className="mt-6">
          <Sheet label="Applications" title="Your placement drive">
            <ul className="divide-y divide-rule/10">
              {pl.offers.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="font-medium">{o.company}</span><span className="text-sm text-graphite">{o.role}</span>
                  {o.ctc_lpa && <span className="tnum text-sm">{o.ctc_lpa} LPA</span>}
                  <span className="ml-auto flex items-center gap-2"><Badge tone={o.status === "accepted" || o.status === "offered" ? "thrive" : o.status === "rejected" ? "critical" : "pen"}>{o.status}</Badge><span className="readout">{date(o.stage_date)}</span></span>
                </li>
              ))}
            </ul>
          </Sheet>
        </Reveal>
      )}
    </>
  );
}
