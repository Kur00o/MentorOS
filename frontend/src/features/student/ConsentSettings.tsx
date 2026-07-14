import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import type { ConsentSettings as Consents } from "@/types";
// import { updateStudentConsents } from "@/api";
import { Switch } from "@/components/primitives";
// import { toast } from "@/store/useToast";

type Key = keyof Consents;

const COPY: Record<Key, { label: string; description: string }> = {
  academic: {
    label: "Academic performance",
    description: "Internal marks and backlogs your mentor can see.",
  },
  attendance: {
    label: "Attendance",
    description: "Your attendance percentage across subjects.",
  },
  placement: {
    label: "Placement readiness",
    description: "Resume, skills and certification status.",
  },
  wellness: {
    label: "Wellbeing",
    description: "",
  },
};

export function ConsentSettings({
  consents: initial,
}: {
  studentId: string;
  consents: Consents;
  /** DPDP: under-18 students cannot self-update — all categories lock. */
  isUnder18?: boolean;
}) {
  const [consents] = useState<Consents>(initial);
  // const [_saving, setSaving] = useState<Key | null>(null);

  // async function _toggle(key: Key, next: boolean) {
  //   if (key === "wellness" || isUnder18) return; // locked
  //   const updated = { ...consents, [key]: next };
  //   setConsents(updated); // optimistic
  //   setSaving(key);
  //   await updateStudentConsents(studentId, updated);
  //   setSaving(null);
  //   toast.success(
  //     next
  //       ? `${COPY[key].label} sharing turned on.`
  //       : `${COPY[key].label} sharing turned off.`,
  //   );
  // }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 rounded-md border border-signal-amber/20 bg-signal-amber/8 p-3">
        <ShieldCheck size={16} className="shrink-0 text-signal-amber" />
        <span className="text-caption text-signal-amber">
          Feature in development 
        </span>
      </div>
      <div className="divide-y divide-ink/8 opacity-60 pointer-events-none select-none">
        {(["academic", "attendance", "placement"] as Key[]).map((key) => (
          <Switch
            key={key}
            label={COPY[key].label}
            locked
            lockedNote={COPY[key].description}
            description={COPY[key].description}
            checked={consents[key]}
            onChange={() => {}}
          />
        ))}
        <Switch
          label={COPY.wellness.label}
          locked
          lockedNote="No data source connected yet — nothing is collected or shared."
          checked={false}
          onChange={() => {}}
        />
      </div>
    </div>
  );
}
