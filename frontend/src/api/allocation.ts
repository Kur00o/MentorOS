import type {
  AllocationMentorWorkload,
  AllocationPendingStudent,
  AllocationResetResponse,
  AllocationRunResponse,
  AllocationStatistics,
} from "@/types";
import { DB } from "@/mock/data";
import { clone, isDemoMode, respond } from "./client";

const BASE = "/api/v1/allocation";

function allocationHeaders(): HeadersInit {
  const token = sessionStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readJson<T>(res: Response): Promise<T> {
  if (res.ok) return res.json() as Promise<T>;

  let detail = "";
  try {
    const body = (await res.json()) as { detail?: unknown };
    detail = typeof body.detail === "string" ? body.detail : "";
  } catch {
    detail = "";
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error(detail || "Allocation API requires an HOD or Admin session.");
  }

  throw new Error(detail || `Allocation API request failed (HTTP ${res.status}).`);
}

function request<T>(path: string, init?: RequestInit): Promise<T> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...allocationHeaders(),
      ...init?.headers,
    },
  }).then(readJson<T>);
}

export function getAllocationStatistics(): Promise<AllocationStatistics> {
  if (isDemoMode()) {
    return respond(() => ({
      total_students: DB.students.length,
      total_mentors: DB.mentors.length,
      allocated: DB.students.length,
      pending: 0,
      by_department: {
        [DB.department.code]: {
          total_students: DB.students.length,
          total_mentors: DB.mentors.length,
          allocated: DB.students.length,
          pending: 0,
        },
      },
    }));
  }
  return request<AllocationStatistics>("/statistics");
}

export function getAllocationWorkload(): Promise<AllocationMentorWorkload[]> {
  if (isDemoMode()) {
    return respond(() => clone(DB.mentors.map((mentor) => ({
      mentor_id: Number(mentor.id.replace("mnt-", "")),
      mentor_name: mentor.name,
      department: DB.department.code,
      current: DB.students.filter((student) => student.mentor_id === mentor.id).length,
      max: 20,
      mentees: DB.students
        .filter((student) => student.mentor_id === mentor.id)
        .map((student) => ({
          id: Number(student.id.replace("stu-", "")),
          usn: student.roll_no,
          full_name: student.name,
          risk_status: student.score.risk_category,
        })),
    }))));
  }
  return request<AllocationMentorWorkload[]>("/workload");
}

export function getAllocationPending(): Promise<AllocationPendingStudent[]> {
  if (isDemoMode()) return respond(() => []);
  return request<AllocationPendingStudent[]>("/pending");
}

export function runAllocation(): Promise<AllocationRunResponse> {
  if (isDemoMode()) {
    return respond(() => ({
      allocated: 0,
      skipped: 0,
      by_department: { [DB.department.code]: { allocated: 0, skipped: 0 } },
    }));
  }
  return request<AllocationRunResponse>("/run", { method: "POST" });
}

export function resetAllocation(): Promise<AllocationResetResponse> {
  if (isDemoMode()) return respond(() => ({ cleared: 0 }));
  return request<AllocationResetResponse>("/reset", { method: "POST" });
}
