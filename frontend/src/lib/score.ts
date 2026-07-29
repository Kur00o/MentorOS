/**
 * The Student Success Score — the product's one real piece of IP.
 *
 * A transparent weighted blend of four components. This module is the single
 * source of truth for the formula; both the mock data layer (which derives
 * every student's score from raw signals) and the UI (which explains the
 * breakdown on screen) import from here. Nothing is hardcoded downstream.
 *
 *   score = 0.35 × attendance
 *         + 0.35 × academic
 *         + 0.15 × engagement
 *         + 0.15 × placement
 */
import type {
  PlacementProfile,
  RiskCategory,
  ScoreBreakdown,
  StudentSignals,
} from "@/types";
import { clamp, round } from "@/lib/utils";

export const COMPONENT_WEIGHTS = {
  attendance: 0.35,
  academic: 0.35,
  engagement: 0.15,
  placement: 0.15,
} as const;

/** Login count that counts as "fully engaged" over a 30-day window. */
const TARGET_LOGINS_30D = 42;
/** Penalty applied to the academic component per active backlog. */
const BACKLOG_PENALTY = 10;
/** Engagement is relative — an average-engaged student lands here. */
const ENGAGEMENT_COHORT_ANCHOR = 72;

export type ComponentKey = keyof typeof COMPONENT_WEIGHTS;

/** attendance_component = attendance %, directly. */
export function attendanceComponent(signals: StudentSignals): number {
  const pct = signals.attendance_pct;
  return pct >= 80 ? 100 : clamp(pct);
}

/**
 * academic_component = avg of (internal / max × 100) across subjects,
 * minus 10 per active backlog, floored at 0.
 */
export function academicComponent(signals: StudentSignals): number {
  if (signals.subjects.length === 0) return 0;
  const avg =
    signals.subjects.reduce(
      (sum, s) => sum + (s.internal_marks / s.max_internal) * 100,
      0,
    ) / signals.subjects.length;
  return clamp(avg - signals.active_backlogs * BACKLOG_PENALTY);
}

/**
 * Raw engagement, pre-normalization: a 50/50 blend of login frequency and
 * assignment submission rate. The cohort mean of this value is what we
 * normalize against (see {@link engagementComponent}).
 */
export function engagementRaw(signals: StudentSignals): number {
  const loginScore = clamp((signals.logins_30d / TARGET_LOGINS_30D) * 100);
  const submissionScore = clamp(signals.assignment_submission_rate * 100);
  return 0.5 * loginScore + 0.5 * submissionScore;
}

/**
 * engagement_component = login/submission blend, normalized against the
 * cohort average so the score reflects engagement *relative to peers*.
 */
export function engagementComponent(
  signals: StudentSignals,
  cohortMeanEngagementRaw: number,
): number {
  if (cohortMeanEngagementRaw <= 0) return clamp(engagementRaw(signals));
  return clamp(
    (engagementRaw(signals) / cohortMeanEngagementRaw) * ENGAGEMENT_COHORT_ANCHOR,
  );
}

/** placement_component = % of the readiness checklist completed. */
export function placementComponent(profile: PlacementProfile): number {
  const items = [
    profile.resume_uploaded,
    profile.skills_listed,
    profile.certifications_added,
  ];
  const done = items.filter(Boolean).length;
  return round((done / items.length) * 100);
}

/** Risk bands: green ≥ 70, amber 50–69, coral < 50. */
export function riskCategory(total: number): RiskCategory {
  if (total >= 70) return "green";
  if (total >= 50) return "amber";
  return "coral";
}

/** Compute the full breakdown from raw signals + cohort context. */
export function computeScore(
  signals: StudentSignals,
  cohortMeanEngagementRaw: number,
): ScoreBreakdown {
  const attendance = attendanceComponent(signals);
  const academic = academicComponent(signals);
  const engagement = engagementComponent(signals, cohortMeanEngagementRaw);
  const placement = placementComponent(signals.placement_profile);

  const total =
    COMPONENT_WEIGHTS.attendance * attendance +
    COMPONENT_WEIGHTS.academic * academic +
    COMPONENT_WEIGHTS.engagement * engagement +
    COMPONENT_WEIGHTS.placement * placement;

  return {
    attendance_component: round(attendance, 1),
    academic_component: round(academic, 1),
    engagement_component: round(engagement, 1),
    placement_component: round(placement, 1),
    total_score: round(total, 1),
    risk_category: riskCategory(total),
  };
}

/* ----------------------------------------------------------------
   Presentation metadata — drives the on-screen explanation so the
   score is never a mystery number (Quality bar, Section 7).
   ---------------------------------------------------------------- */

export interface ComponentMeta {
  key: ComponentKey;
  label: string;
  short: string;
  weight: number;
  /** Plain-language description of what feeds this component. */
  description: string;
}

export const COMPONENT_META: ComponentMeta[] = [
  {
    key: "attendance",
    label: "Attendance",
    short: "Att",
    weight: COMPONENT_WEIGHTS.attendance,
    description: "Share of classes attended this semester.",
  },
  {
    key: "academic",
    label: "Academic",
    short: "Acad",
    weight: COMPONENT_WEIGHTS.academic,
    description: "Internal marks across subjects, less a penalty per backlog.",
  },
  {
    key: "engagement",
    label: "Engagement",
    short: "Eng",
    weight: COMPONENT_WEIGHTS.engagement,
    description: "Logins and assignment submissions, relative to the cohort.",
  },
  {
    key: "placement",
    label: "Placement",
    short: "Plac",
    weight: COMPONENT_WEIGHTS.placement,
    description: "Resume, skills and certifications on the placement profile.",
  },
];

export interface RiskMeta {
  category: RiskCategory;
  label: string;
  /** CSS custom-property name for the signal color. */
  colorVar: string;
  hex: string;
  /** Mentor-facing one-liner. */
  blurb: string;
}

export const RISK_META: Record<RiskCategory, RiskMeta> = {
  green: {
    category: "green",
    label: "On track",
    colorVar: "var(--signal-green)",
    hex: "#2F8F6B",
    blurb: "Steady across all four signals. No action needed right now.",
  },
  amber: {
    category: "amber",
    label: "Monitor",
    colorVar: "var(--signal-amber)",
    hex: "#C98A2E",
    blurb: "One or two signals are slipping. Worth a check-in this month.",
  },
  coral: {
    category: "coral",
    label: "At risk",
    colorVar: "var(--signal-coral)",
    hex: "#C0473D",
    blurb: "Multiple signals are low. Reach out and log a meeting soon.",
  },
};

export const RISK_ORDER: RiskCategory[] = ["coral", "amber", "green"];

export function componentValue(
  breakdown: ScoreBreakdown,
  key: ComponentKey,
): number {
  switch (key) {
    case "attendance":
      return breakdown.attendance_component;
    case "academic":
      return breakdown.academic_component;
    case "engagement":
      return breakdown.engagement_component;
    case "placement":
      return breakdown.placement_component;
  }
}
