import type { LucideIcon } from "lucide-react";
import {
  CalendarDays,
  FileDown,
  Grid3x3,
  Home,
  LayoutDashboard,
  ShieldCheck,
  Sparkles,
  TableProperties,
  TrendingUp,
  Upload,
  UserCircle,
  Users,
  Users2,
} from "lucide-react";
import type { Role } from "@/types";

export interface NavItem {
  label: string;
  icon: LucideIcon;
  to: string;
  anchor?: string;
  action?: "companion";
}

export const NAV: Record<Role, NavItem[]> = {
  student: [
    { label: "Home", icon: Home, to: "/app/student" },
    { label: "Attendance", icon: TableProperties, to: "/app/student/attendance" },
    { label: "My meetings", icon: CalendarDays, to: "/app/student/meetings" },
    { label: "Profile", icon: UserCircle, to: "/app/student/profile" },
    { label: "Privacy & consent", icon: ShieldCheck, to: "/app/student/consent" },
    { label: "AI Companion", icon: Sparkles, to: "/app/student", action: "companion" },
  ],
  mentor: [
    { label: "Mentee roster", icon: Users, to: "/app/mentor", anchor: "roster" },
    { label: "Upcoming meetings", icon: CalendarDays, to: "/app/mentor", anchor: "meetings" },
  ],
  hod: [
    { label: "Overview", icon: LayoutDashboard, to: "/app/hod", anchor: "overview" },
    { label: "Risk heatmap", icon: Grid3x3, to: "/app/hod", anchor: "heatmap" },
    { label: "Mentor workload", icon: Users2, to: "/app/hod", anchor: "workload" },
    { label: "Semester trend", icon: TrendingUp, to: "/app/hod", anchor: "trend" },
  ],
  admin: [
    { label: "Users", icon: Users, to: "/app/admin", anchor: "users" },
    { label: "Create users", icon: Users2, to: "/app/admin/create-users" },
    { label: "Data import", icon: Upload, to: "/app/admin", anchor: "import" },
    { label: "Compliance exports", icon: FileDown, to: "/app/admin", anchor: "exports" },
  ],
};
