import type { Role } from "@/types";
import { DB } from "@/mock/data";
import { HOD_NAME } from "@/mock/names";

/**
 * Demo identities. In a real app these would come from the auth session; here
 * the role switcher just picks which one is "active". Resolution is synchronous
 * because it's session state, not a data fetch.
 */
export const DEMO = {
  studentId: DB.demoStudentId,
  mentorId: DB.demoMentorId,
  departmentId: DB.department.id,
  departmentCode: DB.department.code,
};

export interface Identity {
  role: Role;
  id: string;
  name: string;
  /** Secondary line under the name in the topbar. */
  sublabel: string;
  hue: number;
}

export function resolveIdentity(role: Role): Identity {
  switch (role) {
    case "student": {
      const s = DB.students.find((st) => st.id === DEMO.studentId)!;
      return {
        role,
        id: s.id,
        name: s.name,
        sublabel: `${s.roll_no} · Sem ${s.semester}`,
        hue: s.avatar_hue,
      };
    }
    case "mentor": {
      const m = DB.mentors.find((mt) => mt.id === DEMO.mentorId)!;
      return { role, id: m.id, name: m.name, sublabel: m.title, hue: m.avatar_hue };
    }
    case "hod":
      return {
        role,
        id: "usr-hod",
        name: HOD_NAME,
        sublabel: `Head of ${DB.department.code}`,
        hue: 268,
      };
    case "admin":
      return {
        role,
        id: "usr-admin",
        name: "Priya Nair",
        sublabel: "Platform administrator",
        hue: 162,
      };
  }
}

export const ROLE_HOME: Record<Role, string> = {
  student: "/app/student",
  mentor: "/app/mentor",
  hod: "/app/hod",
  admin: "/app/admin",
};

export const ROLE_TITLE: Record<Role, string> = {
  student: "Student",
  mentor: "Mentor",
  hod: "HOD",
  admin: "Admin",
};

export async function getMe(): Promise<any> {
  const token = sessionStorage.getItem("token");
  if (!token) return null;
  const res = await fetch(`/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to get current user details (HTTP ${res.status}).`);
  }
  return res.json();
}
