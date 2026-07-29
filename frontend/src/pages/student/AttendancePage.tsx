import { CheckCircle2, XCircle } from "lucide-react";
import { getMyStudentProfile } from "@/api";
import { useAsync } from "@/lib/useAsync";
import { Button, EmptyState, GlassCard, LoadingState } from "@/components/primitives";
import { SectionHeading } from "@/components/SectionHeading";

interface SubjectRow {
  code: string;
  name: string;
  total_classes: number;
  attended: number;
  pct: number;
}

function pctColor(pct: number): string {
  if (pct >= 75) return "text-signal-green";
  if (pct >= 60) return "text-signal-amber";
  return "text-signal-coral";
}

function pctHex(pct: number): string {
  if (pct >= 75) return "var(--color-signal-green)";
  if (pct >= 60) return "var(--color-signal-amber)";
  return "var(--color-signal-coral)";
}

function StatusBadge({ pct }: { pct: number }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{
        background: `color-mix(in srgb, ${pctHex(pct)} 14%, white)`,
        color: pctHex(pct),
      }}
    >
      {pct >= 75 ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
      {pct >= 75 ? "On track" : pct >= 60 ? "At risk" : "Critical"}
    </span>
  );
}

export default function AttendancePage() {
  const student = useAsync(() => getMyStudentProfile(), []);

  if (student.loading) return <LoadingState label="Loading attendance…" />;
  if (student.error || !student.data) {
    return (
      <EmptyState
        icon={<XCircle size={22} />}
        title="Couldn't load attendance"
        body={student.error ?? "Make sure you're signed in."}
        action={<Button onClick={student.reload}>Try again</Button>}
      />
    );
  }

  const s = student.data;
  const subjects = s.signals.subjects;

  const rows: SubjectRow[] = subjects.map((sub) => {
    const hasRealAttendance = typeof sub.total_classes === "number" && typeof sub.attended_classes === "number";
    const total_classes = hasRealAttendance ? sub.total_classes! : 60;
    const attended = hasRealAttendance ? sub.attended_classes! : Math.round((s.signals.attendance_pct / 100) * total_classes);
    const pct = hasRealAttendance ? (total_classes > 0 ? (attended / total_classes) * 100 : 0) : s.signals.attendance_pct;
    return {
      code: sub.code,
      name: sub.name,
      total_classes,
      attended,
      pct,
    };
  });

  const totalClasses = rows.reduce((s, r) => s + r.total_classes, 0);
  const totalAttended = rows.reduce((s, r) => s + r.attended, 0);
  const overallPct = totalClasses > 0 ? (totalAttended / totalClasses) * 100 : s.signals.attendance_pct;

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading
        title="Subject-wise attendance"
        description={`Semester ${s.semester} · ${s.department_id}`}
      />

      <GlassCard padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-ink/8 bg-ink/[0.02]">
                <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Subject</th>
                <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Subject ID</th>
                <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Attended</th>
                <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Total Classes</th>
                <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Attendance</th>
                <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/6">
              {rows.map((row) => (
                <tr key={row.code} className="transition-colors hover:bg-ink/[0.02]">
                  <td className="px-5 py-3.5 text-body font-medium text-ink">{row.name}</td>
                  <td className="px-5 py-3.5 font-mono text-caption text-ink-soft">{row.code}</td>
                  <td className="px-5 py-3.5 text-right font-mono tnum text-caption text-ink">
                    {row.attended}
                  </td>
                  <td className="px-5 py-3.5 text-right font-mono tnum text-caption text-ink">
                    {row.total_classes}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <span className={`font-mono tnum text-caption font-semibold ${pctColor(row.pct)}`}>
                      {row.pct.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <StatusBadge pct={row.pct} />
                  </td>
                </tr>
              ))}
            </tbody>
            {/* Total row */}
            <tfoot>
              <tr className="border-t-2 border-ink/12 bg-ink/[0.03]">
                <td className="px-5 py-3.5 text-caption font-semibold text-ink" colSpan={2}>
                  Total
                </td>
                <td className="px-5 py-3.5 text-right font-mono tnum text-caption font-semibold text-ink">
                  {totalAttended}
                </td>
                <td className="px-5 py-3.5 text-right font-mono tnum text-caption font-semibold text-ink">
                  {totalClasses}
                </td>
                <td className="px-5 py-3.5 text-right">
                  <span className={`font-mono tnum text-caption font-bold ${pctColor(overallPct)}`}>
                    {overallPct.toFixed(1)}%
                  </span>
                </td>
                <td className="px-5 py-3.5 text-right">
                  <StatusBadge pct={overallPct} />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </GlassCard>

      {/* Note about data source */}
      <p className="text-caption text-ink-soft">
        Attendance data is sourced from institutional records and updated periodically.
        Subject-level data will appear here once connected to the attendance system.
      </p>
    </div>
  );
}
