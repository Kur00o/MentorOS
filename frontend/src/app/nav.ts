import { Activity, AlarmClock, BarChart3, BookOpenCheck, Briefcase, Building2, CalendarDays, ClipboardList, Database, FileDown, GaugeCircle, Network, ScrollText, ShieldCheck, Shuffle, Users, UserRound, type LucideIcon } from "lucide-react";
import type { Role } from "@/lib/types";

export interface NavItem { to: string; label: string; icon: LucideIcon; end?: boolean; mobile?: boolean }

export const NAV: Record<Role, NavItem[]> = {
  student: [
    { to: "/student", label: "My signal", icon: GaugeCircle, end: true, mobile: true },
    { to: "/student/attendance", label: "Attendance", icon: CalendarDays, mobile: true },
    { to: "/student/academics", label: "Academics", icon: BookOpenCheck, mobile: true },
    { to: "/student/meetings", label: "Mentoring", icon: ClipboardList, mobile: true },
    { to: "/student/placement", label: "Placement", icon: Briefcase },
    { to: "/student/profile", label: "Profile & privacy", icon: ShieldCheck },
  ],
  mentor: [
    { to: "/mentor", label: "Today", icon: Activity, end: true, mobile: true },
    { to: "/mentor/mentees", label: "Mentees", icon: Users, mobile: true },
    { to: "/mentor/meetings", label: "Meetings", icon: CalendarDays, mobile: true },
    { to: "/mentor/alerts", label: "Alerts", icon: AlarmClock, mobile: true },
  ],
  hod: [
    { to: "/hod", label: "Department", icon: BarChart3, end: true, mobile: true },
    { to: "/hod/students", label: "Students", icon: Users, mobile: true },
    { to: "/hod/allocation", label: "Allocation", icon: Shuffle, mobile: true },
    { to: "/hod/alerts", label: "Alerts", icon: AlarmClock },
    { to: "/hod/meetings", label: "Meetings", icon: CalendarDays },
    { to: "/hod/reports", label: "Data & reports", icon: FileDown, mobile: true },
  ],
  admin: [
    { to: "/admin", label: "Institution", icon: Building2, end: true, mobile: true },
    { to: "/admin/users", label: "People", icon: UserRound, mobile: true },
    { to: "/admin/students", label: "Students", icon: Users },
    { to: "/admin/analytics", label: "Analytics", icon: BarChart3 },
    { to: "/admin/allocation", label: "Allocation", icon: Shuffle },
    { to: "/admin/data", label: "Data", icon: Database, mobile: true },
    { to: "/admin/integrations", label: "Integrations", icon: Network, mobile: true },
    { to: "/admin/audit", label: "Audit log", icon: ScrollText },
  ],
};

export const ROLE_LABEL: Record<Role, string> = { student: "Student", mentor: "Mentor", hod: "Head of Department", admin: "Administrator" };
