import { useRef, useState } from "react";
import { Camera, KeyRound, Lock, Mail, Phone, Save, UserCircle2 } from "lucide-react";
import { getMyStudentProfile } from "@/api";
import { useAsync } from "@/lib/useAsync";
import { Avatar } from "@/components/primitives/Avatar";
import { Button, EmptyState, GlassCard, LoadingState } from "@/components/primitives";
import { SectionHeading } from "@/components/SectionHeading";
import { toast } from "@/store/useToast";

const API_BASE = "/api/v1";

function authHeaders(): Record<string, string> {
  const token = sessionStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function semesterToYear(semester: number): string {
  const year = Math.ceil(semester / 2);
  const suffixes = ["", "1st", "2nd", "3rd", "4th"];
  return `${suffixes[year] ?? `${year}th`} Year`;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide font-medium text-ink-soft">{label}</p>
      <p className="mt-0.5 text-body text-ink">{value || "—"}</p>
    </div>
  );
}

function InputRow({
  id, label, type = "text", placeholder, value, onChange, icon,
}: {
  id: string; label: string; type?: string; placeholder: string;
  value: string; onChange: (v: string) => void; icon: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-caption font-medium text-ink-soft" htmlFor={id}>{label}</label>
      <div className="flex items-center gap-2 rounded-md border border-ink/12 bg-white/60 px-3 py-2 focus-within:border-azure-400 focus-within:ring-1 focus-within:ring-azure-400/30">
        <span className="shrink-0 text-ink-soft">{icon}</span>
        <input
          id={id} type={type} placeholder={placeholder} value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-body text-ink placeholder:text-ink-soft/50 focus:outline-none"
        />
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const student = useAsync(() => getMyStudentProfile(), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ student_mobile: "", parent_mobile: "", parent_email: "" });
  const [formInit, setFormInit] = useState(false);
  const [pwForm, setPwForm] = useState({ current: "", next: "", confirm: "" });
  const [pwSaving, setPwSaving] = useState(false);

  // Initialise form once data loads
  if (student.data && !formInit) {
    setForm({
      student_mobile: student.data.signals.placement_profile.resume_uploaded ? "" : "",
      parent_mobile: "",
      parent_email: "",
    });
    setFormInit(true);
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const resp = await fetch(`${API_BASE}/students/me/profile-picture`, {
        method: "POST",
        headers: authHeaders() as Record<string, string>,
        body,
      });
      if (!resp.ok) throw new Error(await resp.text());
      toast.success("Profile picture updated.");
      window.dispatchEvent(new Event("profile-picture-updated"));
      student.reload();
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : "Upload failed. Try again.";
      let detail = message;
      try {
        const parsed = JSON.parse(message) as { detail?: string };
        detail = parsed.detail || message;
      } catch {
        // Keep the plain response text when the backend did not return JSON.
      }
      toast.error(detail);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const resp = await fetch(`${API_BASE}/students/me`, {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(form.student_mobile && { student_mobile: form.student_mobile }),
          ...(form.parent_mobile && { parent_mobile: form.parent_mobile }),
          ...(form.parent_email && { parent_email: form.parent_email }),
        }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      toast.success("Profile updated.");
      student.reload();
    } catch {
      toast.error("Could not save changes. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (pwForm.next.length < 8) { toast.error("Password must be at least 8 characters."); return; }
    if (pwForm.next !== pwForm.confirm) { toast.error("Passwords do not match."); return; }
    setPwSaving(true);
    try {
      const resp = await fetch(`${API_BASE}/auth/change-password`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: pwForm.current, new_password: pwForm.next }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) { toast.error(data?.detail || "Could not change password."); return; }
      toast.success("Password changed successfully.");
      setPwForm({ current: "", next: "", confirm: "" });
    } catch {
      toast.error("Something went wrong. Try again.");
    } finally {
      setPwSaving(false);
    }
  }

  if (student.loading) return <LoadingState label="Loading your profile…" />;
  if (student.error || !student.data) {
    return (
      <EmptyState
        icon={<UserCircle2 size={22} />}
        title="Profile not found"
        body="Make sure you're signed in."
        action={<Button onClick={student.reload}>Try again</Button>}
      />
    );
  }

  const s = student.data;
  const pictureUrl = s.profile_picture_url;

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading
        title="My profile"
        description="Your personal details and contact information."
      />

      {/* ── Photo + read-only details ── */}
      <GlassCard tier="strong" className="flex flex-wrap items-start gap-6">
        {/* Avatar / photo upload */}
        <div className="flex flex-col items-center gap-2">
          <div className="relative">
            {pictureUrl ? (
              <img
                src={pictureUrl}
                alt={s.name}
                className="h-24 w-24 rounded-full object-cover border-2 border-white shadow-sm"
              />
            ) : (
              <Avatar name={s.name} hue={s.avatar_hue} size="lg" className="h-24 w-24 text-display-lg" />
            )}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-azure-500 text-white shadow transition-colors hover:bg-azure-600 disabled:opacity-60"
              title="Change photo"
            >
              <Camera size={14} />
            </button>
          </div>
          <span className="text-[11px] text-ink-soft">{uploading ? "Uploading…" : "Change photo"}</span>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handlePhotoUpload}
          />
        </div>

        {/* Identity details */}
        <div className="grid min-w-0 flex-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          <Field label="Full name" value={s.name} />
          <Field label="Email" value={s.email} />
          <Field label="PRN Number" value={s.roll_no} />
          <Field label="Department" value={s.department_id} />
          <Field label="Year / Semester" value={`${semesterToYear(s.semester)} · Sem ${s.semester}`} />
        </div>
      </GlassCard>

      {/* ── Editable contact details ── */}
      <GlassCard className="flex flex-col gap-5">
        <h3 className="font-display text-body font-semibold text-ink">Contact details</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <InputRow id="student_mobile" label="Your mobile number" type="tel"
            placeholder="+91 98765 43210" value={form.student_mobile} icon={<Phone size={14} />}
            onChange={(v) => setForm((f) => ({ ...f, student_mobile: v }))} />
          <InputRow id="parent_mobile" label="Parent / guardian mobile" type="tel"
            placeholder="+91 98765 43210" value={form.parent_mobile} icon={<Phone size={14} />}
            onChange={(v) => setForm((f) => ({ ...f, parent_mobile: v }))} />
          <div className="sm:col-span-2">
            <InputRow id="parent_email" label="Parent / guardian email" type="email"
              placeholder="parent@email.com" value={form.parent_email} icon={<Mail size={14} />}
              onChange={(v) => setForm((f) => ({ ...f, parent_email: v }))} />
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving} iconRight={<Save size={15} />}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </GlassCard>

      {/* ── Change password ── */}
      <GlassCard className="flex flex-col gap-5">
        <h3 className="font-display text-body font-semibold text-ink">Change password</h3>
        <form onSubmit={handleChangePassword} className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <InputRow id="current-pw" label="Current password" type="password"
              placeholder="••••••••" value={pwForm.current} icon={<Lock size={14} />}
              onChange={(v) => setPwForm((f) => ({ ...f, current: v }))} />
          </div>
          <InputRow id="new-pw" label="New password" type="password"
            placeholder="At least 8 characters" value={pwForm.next} icon={<KeyRound size={14} />}
            onChange={(v) => setPwForm((f) => ({ ...f, next: v }))} />
          <InputRow id="confirm-pw" label="Confirm new password" type="password"
            placeholder="Re-enter new password" value={pwForm.confirm} icon={<KeyRound size={14} />}
            onChange={(v) => setPwForm((f) => ({ ...f, confirm: v }))} />
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" disabled={pwSaving} iconRight={<KeyRound size={15} />}>
              {pwSaving ? "Changing…" : "Change password"}
            </Button>
          </div>
        </form>
      </GlassCard>

      <p className="text-caption text-ink-soft">
        Name, PRN Number, department, and semester are set by the institution and cannot be edited here.
        Contact your admin to request changes.
      </p>
    </div>
  );
}
