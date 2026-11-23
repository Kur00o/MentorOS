export type Role = "student" | "mentor" | "hod" | "admin";
export type Band = "green" | "amber" | "coral" | "insufficient_data";
export type Pillar = "attendance" | "academic" | "engagement" | "placement";

export interface Me {
  id: number;
  email: string;
  full_name: string;
  role: Role;
  avatar_url: string | null;
  phone: string | null;
  department: { id: number; code: string; name: string } | null;
  student_id: number | null;
  mentor_id: number | null;
  is_synthetic: boolean;
  last_login_at: string | null;
}

export interface ScoreBlock {
  total: number | null;
  band: Band;
  delta: number | null;
  updated_at: string | null;
  components: Record<Pillar, number | null>;
  weights: Record<Pillar, number>;
  weakest: Pillar | null;
  thresholds: { green: number; amber: number };
}

export interface HistoryPoint {
  period: string;
  week: number | null;
  computed_at: string;
  total: number | null;
  band: Band;
  attendance: number | null;
  academic: number | null;
  engagement: number | null;
  placement: number | null;
}

export interface ActionItem {
  id: string;
  text: string;
  due: string | null;
  owner?: "student" | "mentor";
  done: boolean;
  done_at?: string | null;
  meeting_id?: number;
  meeting_title?: string;
}

export interface MeetingLog {
  summary: string;
  topics: string[];
  action_items: ActionItem[];
  student_mood: string | null;
  follow_up_on: string | null;
  logged_at: string;
  private_notes?: string | null;
}

export type MeetingStatus = "requested" | "scheduled" | "completed" | "cancelled" | "no_show";
export type MeetingMode = "in_person" | "video" | "phone";

export interface Meeting {
  id: number;
  mentor_id: number;
  student_id: number;
  title: string;
  agenda: string | null;
  scheduled_at: string;
  duration_minutes: number;
  mode: MeetingMode;
  location: string | null;
  status: MeetingStatus;
  requested_by: string;
  created_at: string;
  log: MeetingLog | null;
  student_name?: string;
  student_usn?: string;
  student_band?: Band;
  mentor_name?: string;
}

export interface Alert {
  id: number;
  student_id: number;
  rule: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string | null;
  evidence: Record<string, unknown>;
  status: "open" | "acknowledged" | "resolved";
  created_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
  student_name?: string;
  student_usn?: string;
  student_band?: Band;
  student_score?: number | null;
}

export interface SubjectAttendance {
  subject_id: number;
  code: string;
  name: string;
  credits: number;
  kind: string;
  faculty: string | null;
  attended: number;
  total: number;
  pct: number | null;
  needed_for_75: number;
  can_skip: number;
}

export interface SubjectMarks {
  subject_id: number;
  code: string;
  name: string;
  assessments: { assessment: string; max: number; obtained: number; on: string | null }[];
  obtained: number;
  max: number;
  pct: number | null;
}

export interface ConsentEntry {
  consented: boolean;
  notice_version: string;
  decided_at: string | null;
  locked: boolean;
}

export interface Overview {
  profile: {
    id: number;
    user_id: number;
    usn: string;
    name: string;
    email: string;
    phone: string | null;
    avatar_url: string | null;
    department: { id: number; code: string; name: string };
    semester: number;
    section: string | null;
    admission_year: number | null;
    gender: string | null;
    home_city: string | null;
    hostel_resident: boolean;
    guardian_name: string | null;
    guardian_phone: string | null;
    guardian_email: string | null;
    bio: string | null;
    interests: string[];
    status: string;
    is_under_18: boolean;
    date_of_birth: string | null;
    is_synthetic: boolean;
    has_login: boolean;
    last_login_at: string | null;
  };
  mentor: {
    id: number;
    user_id: number;
    name: string;
    email: string;
    phone: string | null;
    avatar_url: string | null;
    designation: string;
    specialization: string | null;
    office: string | null;
  } | null;
  score: ScoreBlock;
  history: HistoryPoint[];
  attendance: {
    overall_pct: number | null;
    attended: number;
    total: number;
    requirement: number;
    needed_for_75: number;
    can_skip: number;
    subjects: SubjectAttendance[];
    weekly: { week: number; week_start: string; held: number; attended: number; pct: number | null }[];
  };
  academics: {
    cgpa: number | null;
    sgpa: number | null;
    active_backlogs: number;
    semesters: { semester: number; period: string; sgpa: number; credits: number; backlogs: number }[];
    subjects: SubjectMarks[];
  };
  engagement: {
    login_count: number | null;
    cohort_avg_logins: number | null;
    active_minutes: number | null;
    assignments_submitted: number | null;
    assignments_total: number | null;
    quizzes_attempted: number | null;
    avg_quiz_score: number | null;
    forum_posts: number | null;
    last_active_at: string | null;
    weekly: { week: number; logins: number; minutes: number; submissions: number }[];
  };
  placement: {
    has_resume: boolean;
    resume_available: boolean;
    skills: string[];
    certifications: string[];
    internships: number;
    mock_tests_taken: number;
    aptitude_score: number | null;
    target_role: string | null;
    status: string;
    linkedin_url: string | null;
    github_url: string | null;
    offers: { id: number; company: string; role: string; ctc_lpa: number | null; status: string; stage_date: string | null }[];
  };
  meetings: { upcoming: Meeting[]; past: Meeting[]; completed_count: number; open_action_items: ActionItem[] };
  alerts: Alert[];
  consents: Record<"academic" | "attendance" | "placement" | "wellness", ConsentEntry>;
  period: string;
}

export interface StudentRow {
  id: number;
  usn: string;
  name: string;
  email: string;
  avatar_url: string | null;
  department: string;
  department_id: number;
  semester: number;
  section: string | null;
  mentor: { id: number; name: string } | null;
  score: number | null;
  band: Band;
  delta: number | null;
  attendance_pct: number | null;
  cgpa: number | null;
  sgpa: number | null;
  active_backlogs: number;
  open_alerts: number;
  high_alerts: number;
  last_meeting_at: string | null;
  next_meeting_at: string | null;
  sparkline: number[];
  has_login: boolean;
  is_synthetic: boolean;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface MentorDashboard {
  mentor: { id: number; name: string; designation: string; department: string; max_mentees: number; specialization: string | null };
  kpis: {
    mentees: number;
    capacity: number;
    avg_score: number | null;
    bands: Record<Band, number>;
    open_alerts: number;
    high_alerts: number;
    meetings_this_month: number;
    pending_requests: number;
    open_action_items: number;
    coverage_45d: number;
  };
  attention: StudentRow[];
  roster: StudentRow[];
  upcoming: Meeting[];
  recent_logs: Meeting[];
  alerts: (Alert & { student_name: string })[];
}

export interface MentorLoadRow {
  id: number;
  name: string;
  designation: string;
  avatar_url: string | null;
  load: number;
  capacity: number;
  avg_score: number | null;
  avg_delta: number | null;
  meetings_30d: number;
  coverage: number;
  at_risk: number;
  open_alerts: number;
  bands: Record<Band, number>;
}

export interface DepartmentAnalytics {
  department: { id: number; code: string; name: string } | null;
  period: string;
  kpis: {
    students: number;
    avg_score: number | null;
    avg_attendance: number | null;
    avg_cgpa: number | null;
    at_risk: number;
    coral: number;
    open_alerts: number;
    high_alerts: number;
    mentors: number;
    assigned: number;
    unassigned: number;
    meeting_coverage: number;
    avg_delta: number | null;
    placement_ready: number;
  };
  bands: Record<Band, number>;
  components: Record<Pillar, number | null>;
  trend: ({ week: number; avg_score: number | null } & Record<Band, number>)[];
  semesters: ({ semester: number; avg_score: number | null; total: number } & Record<Band, number>)[];
  subjects: {
    subject_id: number;
    code: string;
    name: string;
    semester: number;
    faculty: string | null;
    avg_attendance: number | null;
    attendance_shortage: number;
    avg_marks: number | null;
    below_40: number;
    students: number;
  }[];
  mentors: MentorLoadRow[];
  placement: {
    statuses: Record<string, number>;
    with_resume: number;
    funnel: { stage: string; count: number }[];
    offer_statuses: Record<string, number>;
    avg_ctc_lpa: number | null;
    max_ctc_lpa: number | null;
    top_companies: { company: string; offers: number }[];
  };
  alert_rules: { rule: string; count: number }[];
  attention: StudentRow[];
  score_distribution: { bucket: string; lo: number; count: number }[];
}

export interface Integration {
  key: string;
  label: string;
  category: string;
  status: "ok" | "configured" | "not_configured" | "error" | "degraded" | "disabled";
  message: string;
  required: boolean;
  datasets?: string[];
  description?: string;
}

export interface Institution {
  departments: {
    id: number;
    code: string;
    name: string;
    hod: string | null;
    students: number;
    avg_score: number | null;
    bands: Record<Band, number>;
    unassigned: number;
    mentors: number;
    is_synthetic: boolean;
  }[];
  roles: Partial<Record<Role, number>>;
  logins_provisioned: number;
  active_7d: number;
  batches: { id: number; label: string; kind: string; description: string | null; created_at: string; students: number }[];
  real_students: number;
  imports: { id: number; kind: string; source: string; filename: string | null; rows: number; ok: number; status: string; created_at: string }[];
  activity: { id: number; action: string; entity_type: string | null; entity_id: string | null; user_name: string | null; created_at: string }[];
  integrations: Integration[];
  kpis: DepartmentAnalytics["kpis"];
  bands: Record<Band, number>;
  trend: DepartmentAnalytics["trend"];
  components: Record<Pillar, number | null>;
}

export interface CompanionCard {
  type: "score" | "bars" | "students" | "meeting" | "actions" | "recommendations" | "student" | "bands";
  [key: string]: unknown;
}

export interface CompanionMessage {
  id?: number | string;
  role: "user" | "assistant";
  content: string;
  created_at?: string;
  cards?: CompanionCard[];
  suggestions?: string[];
  sources?: { title: string; source: string }[];
  provider?: string;
  intent?: string;
  pending?: boolean;
}

export interface NotificationItem {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
}
