import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Band, Pillar } from "./types";

export const cn = (...v: ClassValue[]) => twMerge(clsx(v));

export const BAND: Record<Band, { label: string; short: string; ink: string; wash: string; text: string; bg: string; hex: string; guide: string }> = {
  green: { label: "Thriving", short: "Green", ink: "rgb(var(--thrive))", wash: "rgb(var(--thrive-wash))", text: "text-thrive", bg: "bg-thrive-wash", hex: "#1E8A5A", guide: "On track — periodic check-ins." },
  amber: { label: "Watch", short: "Amber", ink: "rgb(var(--watch))", wash: "rgb(var(--watch-wash))", text: "text-watch", bg: "bg-watch-wash", hex: "#B76E00", guide: "Emerging risk — check in within a week." },
  coral: { label: "Critical", short: "Coral", ink: "rgb(var(--critical))", wash: "rgb(var(--critical-wash))", text: "text-critical", bg: "bg-critical-wash", hex: "#D3442E", guide: "Critical — meet within 48 hours." },
  insufficient_data: { label: "Awaiting data", short: "No data", ink: "rgb(var(--void))", wash: "rgb(var(--void-wash))", text: "text-void", bg: "bg-void-wash", hex: "#787670", guide: "Attendance or results not imported yet." },
};

export const PILLARS: { key: Pillar; label: string; weight: number; blurb: string }[] = [
  { key: "attendance", label: "Attendance", weight: 0.35, blurb: "Classes attended ÷ classes held, all subjects" },
  { key: "academic", label: "Academic", weight: 0.35, blurb: "Latest SGPA × 10" },
  { key: "engagement", label: "Engagement", weight: 0.15, blurb: "LMS logins vs cohort + assignment submission" },
  { key: "placement", label: "Placement", weight: 0.15, blurb: "Resume 40 · skills 8 each · certifications 4 each" },
];

export const bandFor = (score: number | null | undefined): Band =>
  score == null ? "insufficient_data" : score >= 70 ? "green" : score >= 50 ? "amber" : "coral";

export const num = (v: number | null | undefined, digits = 1) => (v == null || Number.isNaN(v) ? "—" : v.toFixed(digits));
export const pct = (v: number | null | undefined, digits = 0) => (v == null ? "—" : `${v.toFixed(digits)}%`);
export const signed = (v: number | null | undefined, digits = 1) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(digits)}`);

export function date(v: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) {
  if (!v) return "—";
  return new Date(v).toLocaleDateString("en-IN", opts);
}
export function dateTime(v: string | null | undefined) {
  if (!v) return "—";
  return new Date(v).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
export function time(v: string) {
  return new Date(v).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

export function relative(v: string | null | undefined): string {
  if (!v) return "never";
  const diff = new Date(v).getTime() - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [["year", 3.15e10], ["month", 2.6e9], ["week", 6.05e8], ["day", 8.64e7], ["hour", 3.6e6], ["minute", 6e4]];
  for (const [u, ms] of units) if (abs >= ms) return rtf.format(Math.round(diff / ms), u);
  return "just now";
}

export const initials = (name: string) =>
  name
    .replace(/^(Dr|Prof)\.\s*/i, "")
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

export const RULE_LABEL: Record<string, string> = {
  low_attendance: "Low attendance",
  attendance_drop: "Attendance falling",
  subject_shortage: "Subject shortage",
  low_internals: "Weak internals",
  score_drop: "Score drop",
  lms_inactive: "LMS inactive",
  backlogs: "Backlogs",
  no_recent_meeting: "No recent meeting",
};

export const MODE_LABEL = { in_person: "In person", video: "Video call", phone: "Phone" } as const;

export const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};
