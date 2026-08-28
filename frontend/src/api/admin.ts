import type { PlatformUser, Role } from "@/types";
import { DB } from "@/mock/data";
import { HOD_NAME } from "@/mock/names";
import { RISK_META } from "@/lib/score";
import { clone, isDemoMode, respond } from "./client";

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

/** Built once — admin, HOD, the five mentors, then every student. */
function buildUsers(): PlatformUser[] {
  const users: PlatformUser[] = [
    {
      id: "usr-admin",
      name: "Priya Nair",
      email: "priya.nair@example.edu",
      role: "admin",
      department_code: "—",
      status: "active",
      last_active: isoDaysAgo(0),
    },
    {
      id: "usr-hod",
      name: HOD_NAME,
      email: "vikram.rao@cse.example.edu",
      role: "hod",
      department_code: DB.department.code,
      status: "active",
      last_active: isoDaysAgo(1),
    },
    ...DB.mentors.map<PlatformUser>((m, i) => ({
      id: `usr-${m.id}`,
      name: m.name,
      email: m.email,
      role: "mentor",
      department_code: DB.department.code,
      status: "active",
      last_active: isoDaysAgo(i),
    })),
    ...DB.students.map<PlatformUser>((s, i) => ({
      id: `usr-${s.id}`,
      name: s.name,
      email: s.email,
      role: "student",
      department_code: DB.department.code,
      // A couple of invited/suspended rows for realism.
      status: i % 23 === 7 ? "invited" : i % 31 === 5 ? "suspended" : "active",
      last_active: isoDaysAgo((i * 3) % 40),
    })),
  ];
  return users;
}

const USERS = buildUsers();

/** GET /admin/users */
export async function getPlatformUsers(): Promise<PlatformUser[]> {
  const token = sessionStorage.getItem("token");
  if (!token) return clone(USERS);
  try {
    const res = await fetch(`/api/v1/admin/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch users: ${res.status}`);
    }
    const data = await res.json();
    return data.map((u: any) => ({
      id: String(u.id),
      name: u.name,
      email: u.email,
      role: u.role,
      department_code: u.department_code,
      status: u.status,
      last_active: u.last_active,
    }));
  } catch (err) {
    console.warn("Backend error fetching users, falling back to mock:", err);
    return clone(USERS);
  }
}

export async function createPlatformUser(payload: {
  full_name: string;
  email: string;
  role: "Student" | "Mentor" | "HOD";
}): Promise<{ message: string; user_id: number }> {
  const token = sessionStorage.getItem("token");
  if (!token) {
    // Mock mode
    const newId = `usr-mock-${Date.now()}`;
    const newMockUser: PlatformUser = {
      id: newId,
      name: payload.full_name,
      email: payload.email,
      role: payload.role.toLowerCase() as Role,
      department_code: "CSE",
      status: "active",
      last_active: new Date().toISOString(),
    };
    USERS.push(newMockUser);
    return { message: "User created successfully (Mock)", user_id: 9999 };
  }

  const res = await fetch(`/api/v1/admin/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.detail || `Failed to create user (HTTP ${res.status}).`);
  }
  return res.json();
}


export interface ComplianceExport {
  filename: string;
  generated_at: string;
  row_count: number;
  csv: string;
}

const ROLE_LABEL: Record<Role, string> = {
  student: "Student",
  mentor: "Mentor",
  hod: "HOD",
  admin: "Admin",
};

/**
 * POST /admin/exports/naac — generate the mentoring-compliance dataset that
 * feeds NAAC/NBA reporting. Returns a ready-to-download CSV built entirely
 * from the mock data.
 */
export function generateComplianceExport(): Promise<ComplianceExport> {
  return respond<ComplianceExport>(() => {
    const header = [
      "Roll No",
      "Student",
      "Semester",
      "Mentor",
      "Attendance %",
      "Academic",
      "Engagement",
      "Placement",
      "Success Score",
      "Risk Band",
      "Meetings Logged",
    ];
    const mentorName = (id: string) =>
      DB.mentors.find((m) => m.id === id)?.name ?? "—";

    const rows = DB.students.map((s) => {
      const meetings = DB.meetings.filter(
        (m) => m.student_id === s.id && m.status === "completed",
      ).length;
      return [
        s.roll_no,
        s.name,
        `Sem ${s.semester}`,
        mentorName(s.mentor_id),
        s.score.attendance_component,
        s.score.academic_component,
        s.score.engagement_component,
        s.score.placement_component,
        s.score.total_score,
        RISK_META[s.score.risk_category].label,
        meetings,
      ];
    });

    const escape = (v: string | number) => {
      const str = String(v);
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    const csv = [header, ...rows]
      .map((r) => r.map(escape).join(","))
      .join("\r\n");

    const now = new Date();
    return {
      filename: `MentorOS_NAAC_${DB.department.code}_${now.getFullYear()}.csv`,
      generated_at: now.toISOString(),
      row_count: rows.length,
      csv,
    };
  }, [600, 1100]);
}

export { ROLE_LABEL };

/* ----------------------------------------------------------------
   Real CSV import. Unlike the mock helpers above, this hits the
   FastAPI backend directly (multipart upload) and returns its
   row-level validation result. The import endpoints recompute the
   affected students' scores server-side, so no separate recompute
   call is needed.
   ---------------------------------------------------------------- */

export type ImportType = "attendance" | "sgpa" | "lms";

export interface ImportRowError {
  row: number;
  column: string;
  reason: string;
}

export interface ImportResult {
  row_count: number;
  success_count: number;
  error_log: ImportRowError[];
}

/** POST /api/v1/admin/import/:type — multipart upload. */
export async function importCsv(type: ImportType, file: File): Promise<ImportResult> {
  if (isDemoMode()) {
    return respond(() => ({ row_count: 0, success_count: 0, error_log: [] }));
  }
  const form = new FormData();
  form.append("file", file);
  const token = sessionStorage.getItem("token");
  const res = await fetch(`/api/v1/admin/import/${type}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    const msg =
      res.status === 401 || res.status === 403
        ? "Not authorized — sign in as an admin to import."
        : `Import failed (HTTP ${res.status}).`;
    throw new Error(msg);
  }
  return res.json();
}
