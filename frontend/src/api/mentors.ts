import type {
  Meeting,
  MeetingLog,
  MentorDashboardStats,
  MentorRosterItem,
} from "@/types";
import { DB } from "@/mock/data";
import { clone, isDemoMode, respond } from "./client";
import { toMeeting, type BackendMeeting } from "./adapters";

const BASE = "/api/v1/mentoring";

/** The backend derives the mentor from the token, so no mentor id is sent. */
function mentorHeaders(): HeadersInit {
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

  if (res.status === 401) {
    throw new Error(detail || "Your session has expired. Sign in again.");
  }
  if (res.status === 403) {
    throw new Error(detail || "This requires a mentor account.");
  }
  if (res.status === 409) {
    throw new Error(detail || "This meeting has already been logged.");
  }

  throw new Error(detail || `Request failed (HTTP ${res.status}).`);
}

function request<T>(path: string, init?: RequestInit): Promise<T> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...mentorHeaders(),
      ...init?.headers,
    },
  }).then(readJson<T>);
}

function postJson<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

interface RosterItemResponse extends Omit<MentorRosterItem, "last_meeting" | "next_meeting"> {
  last_meeting: BackendMeeting | null;
  next_meeting: BackendMeeting | null;
}

/** GET /mentoring/roster — the signed-in mentor's mentees, lowest score first. */
export async function getMentorRoster(): Promise<MentorRosterItem[]> {
  if (isDemoMode()) {
    return respond(() => {
      const students = DB.students.filter((student) => student.mentor_id === DB.demoMentorId);
      return clone(students.map((student) => {
        const meetings = DB.meetings
          .filter((meeting) => meeting.student_id === student.id && meeting.mentor_id === DB.demoMentorId)
          .sort((a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime());
        const completed = meetings.filter((meeting) => meeting.status === "completed");
        const upcoming = meetings.find((meeting) => meeting.status === "scheduled");
        const openActionItems = completed.reduce((count, meeting) => count + (meeting.log?.action_items.filter((item) => !item.done).length ?? 0), 0);
        return {
          student_id: Number(student.id.replace("stu-", "")),
          usn: student.roll_no,
          full_name: student.name,
          email: student.email,
          department: student.department_id,
          semester: student.semester,
          attendance_component: student.score.attendance_component,
          academic_component: student.score.academic_component,
          engagement_component: student.score.engagement_component,
          placement_component: student.score.placement_component,
          success_score: student.score.total_score,
          risk_status: student.score.risk_category,
          consent_given: student.consents.attendance,
          last_meeting: completed.at(-1),
          next_meeting: upcoming,
          open_action_items: openActionItems,
        };
      }));
    });
  }
  const rows = await request<RosterItemResponse[]>("/roster");
  return rows.map((row) => ({
    ...row,
    last_meeting: row.last_meeting ? toMeeting(row.last_meeting) : undefined,
    next_meeting: row.next_meeting ? toMeeting(row.next_meeting) : undefined,
  }));
}

/** GET /mentoring/dashboard — the summary tiles. */
export function getMentorDashboard(): Promise<MentorDashboardStats> {
  if (isDemoMode()) {
    return respond(() => {
      const students = DB.students.filter((student) => student.mentor_id === DB.demoMentorId);
      const meetings = DB.meetings.filter((meeting) => meeting.mentor_id === DB.demoMentorId);
      return {
        total_mentees: students.length,
        at_risk_count: students.filter((student) => student.score.risk_category === "coral").length,
        needs_attention_count: students.filter((student) => student.score.risk_category === "amber").length,
        on_track_count: students.filter((student) => student.score.risk_category === "green").length,
        upcoming_meetings: meetings.filter((meeting) => meeting.status === "scheduled").length,
        completed_meetings: meetings.filter((meeting) => meeting.status === "completed").length,
        avg_success_score: students.length ? students.reduce((sum, student) => sum + student.score.total_score, 0) / students.length : 0,
      };
    });
  }
  return request<MentorDashboardStats>("/dashboard");
}

/** POST /mentoring/meetings */
export async function scheduleMeeting(input: {
  student_id: number;
  scheduled_for: string;
  mode: Meeting["mode"];
}): Promise<Meeting> {
  if (isDemoMode()) {
    return respond(() => {
      const studentId = `stu-${String(input.student_id).padStart(3, "0")}`;
      const meeting: Meeting = {
        id: `mtg-demo-${Date.now()}`,
        student_id: studentId,
        mentor_id: DB.demoMentorId,
        scheduled_for: input.scheduled_for,
        status: "scheduled",
        mode: input.mode,
      };
      DB.meetings.push(meeting);
      return clone(meeting);
    });
  }
  const created = await postJson<BackendMeeting>("/meetings", {
    student_id: input.student_id,
    title: "Mentoring check-in",
    date: input.scheduled_for,
    mode: input.mode,
  });
  return toMeeting(created);
}

function toLogPayload(log: MeetingLog) {
  return {
    topics_discussed: log.topics,
    action_items: log.action_items.map((a) => a.text),
    next_meeting_date: log.next_meeting_date
      ? log.next_meeting_date.slice(0, 10)
      : null,
    observations: log.summary || null,
  };
}

/** POST /mentoring/meetings/:id/log — closes out a scheduled meeting. */
export async function logMeeting(meetingId: string, log: MeetingLog): Promise<void> {
  if (isDemoMode()) {
    return respond(() => {
      const meeting = DB.meetings.find((item) => item.id === meetingId);
      if (meeting) {
        meeting.status = "completed";
        meeting.log = clone(log);
      }
    });
  }
  await postJson<{ message: string; log_id: number }>(
    `/meetings/${meetingId}/log`,
    toLogPayload(log),
  );
}

/**
 * Record a meeting that already happened. There's no single endpoint for this,
 * so it creates the meeting and then logs it, which also marks it completed.
 */
export async function recordMeeting(input: {
  student_id: number;
  scheduled_for: string;
  mode: Meeting["mode"];
  log: MeetingLog;
}): Promise<void> {
  const meeting = await scheduleMeeting({
    student_id: input.student_id,
    scheduled_for: input.scheduled_for,
    mode: input.mode,
  });
  await logMeeting(meeting.id, input.log);
}
