import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError, qs } from "./api";
import type { Alert, DepartmentAnalytics, Institution, Meeting, MentorDashboard, Overview, Paged, StudentRow } from "./types";

export const useMyOverview = () => useQuery({ queryKey: ["overview", "me"], queryFn: () => api.get<Overview>("/students/me") });
export const useStudentOverview = (id: number | string | undefined) =>
  useQuery({ queryKey: ["overview", Number(id)], queryFn: () => api.get<Overview>(`/students/${id}`), enabled: !!id });

export interface StudentQuery { q?: string; band?: string; department_id?: number; semester?: number; mentor_id?: number; unassigned?: boolean; sort?: string; order?: "asc" | "desc"; page?: number; page_size?: number }
export const useStudents = (p: StudentQuery, enabled = true) =>
  useQuery({ queryKey: ["students", p], queryFn: () => api.get<Paged<StudentRow>>(`/students${qs({ ...p })}`), placeholderData: (prev) => prev, enabled });

export const useMentorDashboard = () => useQuery({ queryKey: ["mentor-dashboard"], queryFn: () => api.get<MentorDashboard>("/mentoring/dashboard") });
export const useMeetings = (p: { status?: string; student_id?: number; limit?: number } = {}) =>
  useQuery({ queryKey: ["meetings", p], queryFn: () => api.get<Meeting[]>(`/mentoring/meetings${qs(p)}`) });
export const useAlerts = (p: { status?: string; severity?: string; student_id?: number } = {}) =>
  useQuery({ queryKey: ["alerts", p], queryFn: () => api.get<Alert[]>(`/alerts${qs(p)}`) });
export const useDeptAnalytics = (department_id?: number) =>
  useQuery({ queryKey: ["analytics", department_id ?? "own"], queryFn: () => api.get<DepartmentAnalytics>(`/analytics/department${qs({ department_id })}`) });
export const useInstitution = () => useQuery({ queryKey: ["institution"], queryFn: () => api.get<Institution>("/analytics/institution") });
export const useDepartments = (enabled = true) =>
  useQuery({ queryKey: ["departments"], enabled, queryFn: () => api.get<{ id: number; code: string; name: string; hod: string | null; hod_user_id: number | null; students: number; mentors: number; subjects: number; is_synthetic: boolean }[]>("/admin/departments"), staleTime: 300_000 });

/** Mutation with toast feedback and cache invalidation. */
export function useAction<TVars, TRes = unknown>(fn: (v: TVars) => Promise<TRes>, opts: { success?: string | ((r: TRes) => string); invalidate?: QueryKey[]; onSuccess?: (r: TRes) => void } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      opts.invalidate?.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      if (opts.success) toast.success(typeof opts.success === "function" ? opts.success(r) : opts.success);
      opts.onSuccess?.(r);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Something went wrong"),
  });
}

export const STAFF_INVALIDATE: QueryKey[] = [["meetings"], ["mentor-dashboard"], ["overview"], ["students"], ["alerts"], ["notifications"], ["analytics"]];
