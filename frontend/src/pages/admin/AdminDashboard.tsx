import { AlertTriangle, FileDown, GraduationCap, Upload, Users } from "lucide-react";
import { getPlatformUsers } from "@/api";
import { useAsync } from "@/lib/useAsync";
import { Button, EmptyState, GlassCard, LoadingState } from "@/components/primitives";
import { SectionHeading } from "@/components/SectionHeading";
import { StatTile } from "@/components/StatTile";
import { UserTable } from "@/features/admin/UserTable";
import { CsvImport } from "@/features/admin/CsvImport";
import { ComplianceExport } from "@/features/admin/ComplianceExport";

export default function AdminDashboard() {
  const users = useAsync(() => getPlatformUsers(), []);

  if (users.loading) return <LoadingState label="Loading users…" />;
  if (users.error || !users.data) {
    return (
      <EmptyState
        icon={<AlertTriangle size={22} />}
        title="We couldn't load the user list"
        body={users.error ?? "Something went wrong."}
        action={<Button onClick={users.reload}>Try again</Button>}
      />
    );
  }

  const all = users.data;
  const students = all.filter((u) => u.role === "student").length;
  const mentors = all.filter((u) => u.role === "mentor").length;
  const pending = all.filter((u) => u.status === "invited").length;

  return (
    <div className="flex flex-col gap-8">
      <SectionHeading
        id="users"
        title="Administration"
        description="People, data imports and accreditation exports for the platform."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="People" value={all.length} icon={<Users size={18} />} sublabel="On the platform" />
        <StatTile label="Students" value={students} icon={<GraduationCap size={18} />} sublabel="Enrolled" />
        <StatTile label="Mentors" value={mentors} sublabel="Assigned" />
        <StatTile label="Pending invites" value={pending} sublabel="Awaiting first sign-in" />
      </div>



      <UserTable users={all} />

      {/* Data import */}
      <section className="flex flex-col gap-3">
        <SectionHeading
          id="import"
          title="Data import"
          description="Bring in attendance, marks and engagement from your SIS or LMS."
          action={
            <span className="hidden items-center gap-1.5 text-caption text-ink-soft sm:flex">
              <Upload size={14} /> CSV or XLSX
            </span>
          }
        />
        <CsvImport />
      </section>

      {/* Exports */}
      <section className="flex flex-col gap-3">
        <SectionHeading
          id="exports"
          title="Compliance exports"
          description="Generate accreditation-ready reports from live mentoring data."
          action={
            <span className="hidden items-center gap-1.5 text-caption text-ink-soft sm:flex">
              <FileDown size={14} /> NAAC · NBA
            </span>
          }
        />
        <GlassCard>
          <ComplianceExport />
        </GlassCard>
      </section>
    </div>
  );
}
