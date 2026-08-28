import { Fragment, useMemo, useState } from "react";
import {
  CalendarPlus,
  ChevronDown,
  ClipboardCheck,
  Search,
  Users,
} from "lucide-react";
import type { MentorRosterItem, RiskStatus, ScoreBreakdown } from "@/types";
import { RISK_META } from "@/lib/score";
import { Avatar, Badge, Button, EmptyState, RiskBadge } from "@/components/primitives";
import { SignalDisc } from "@/components/SignalDisc";
import { cn, formatDate, daysAgoLabel } from "@/lib/utils";

type SortKey = "name" | "score" | "attendance" | "risk";
type RiskFilter = "all" | RiskStatus;

const RISK_RANK: Record<RiskStatus, number> = {
  coral: 0,
  amber: 1,
  green: 2,
  insufficient_data: 3,
};

/** Deterministic hue so a student's avatar stays the same colour across loads. */
function avatarHue(studentId: number): number {
  return 200 + ((studentId * 37) % 150);
}

/** Placeholder for a value the backend genuinely doesn't have. */
function NoValue() {
  return <span className="text-caption text-ink-soft">—</span>;
}

/**
 * The Signal Disc needs a full four-axis breakdown. Students scored before the
 * engine ran only have a total, so there's nothing to plot — return null and
 * the caller shows a dash instead of a misleading empty disc.
 */
function toBreakdown(entry: MentorRosterItem): ScoreBreakdown | null {
  if (
    entry.success_score === null ||
    entry.risk_status === "insufficient_data" ||
    entry.attendance_component === null ||
    entry.academic_component === null
  ) {
    return null;
  }
  return {
    attendance_component: entry.attendance_component,
    academic_component: entry.academic_component,
    engagement_component: entry.engagement_component ?? 0,
    placement_component: entry.placement_component ?? 0,
    total_score: entry.success_score,
    risk_category: entry.risk_status,
  };
}

export function RosterTable({
  rows,
  onSchedule,
  onLog,
}: {
  rows: MentorRosterItem[];
  onSchedule: (entry: MentorRosterItem) => void;
  onLog: (entry: MentorRosterItem) => void;
}) {
  const [query, setQuery] = useState("");
  const [risk, setRisk] = useState<RiskFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [expanded, setExpanded] = useState<number | null>(null);

  const counts = useMemo(() => {
    const c: Record<RiskFilter, number> = {
      all: rows.length,
      green: 0,
      amber: 0,
      coral: 0,
      insufficient_data: 0,
    };
    for (const r of rows) c[r.risk_status]++;
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (risk !== "all" && r.risk_status !== risk) return false;
      if (!q) return true;
      return (
        r.full_name.toLowerCase().includes(q) || r.usn.toLowerCase().includes(q)
      );
    });
    // Students we couldn't score sort last on the numeric columns — we don't
    // know where they belong, so they shouldn't lead either direction.
    const byNumber = (a: number | null, b: number | null) => {
      if (a === null && b === null) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      return a - b;
    };
    out = [...out].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = a.full_name.localeCompare(b.full_name);
          break;
        case "score":
          cmp = byNumber(a.success_score, b.success_score);
          break;
        case "attendance":
          cmp = byNumber(a.attendance_component, b.attendance_component);
          break;
        case "risk":
          cmp = RISK_RANK[a.risk_status] - RISK_RANK[b.risk_status];
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return out;
  }, [rows, query, risk, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : key === "score" ? "asc" : "desc");
    }
  }

  const SortHeader = ({ label, k, className }: { label: string; k: SortKey; className?: string }) => (
    <th className={cn("px-3 py-2.5 text-left", className)}>
      <button
        type="button"
        onClick={() => toggleSort(k)}
        className={cn(
          "inline-flex items-center gap-1 text-caption font-semibold uppercase tracking-wide transition-colors",
          sortKey === k ? "text-ink" : "text-ink-soft hover:text-ink",
        )}
      >
        {label}
        <ChevronDown
          size={13}
          className={cn(
            "transition-transform",
            sortKey === k ? "opacity-100" : "opacity-30",
            sortKey === k && sortDir === "asc" && "rotate-180",
          )}
        />
      </button>
    </th>
  );

  const FILTERS: Array<{ key: RiskFilter; label: string }> = [
    { key: "all", label: "All" },
    { key: "coral", label: RISK_META.coral.label },
    { key: "amber", label: RISK_META.amber.label },
    { key: "green", label: RISK_META.green.label },
    { key: "insufficient_data", label: "No data" },
  ];

  return (
    <div className="glass-quiet overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 border-b border-ink/8 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative sm:w-72">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or roll number"
            aria-label="Search roster"
            className="h-10 w-full rounded-sm border border-ink/8 bg-white/70 pl-9 pr-3 text-body text-ink placeholder:text-ink-soft/60 focus:border-azure-500 focus:outline-none focus:ring-2 focus:ring-azure-200"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setRisk(f.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-caption transition-colors",
                risk === f.key
                  ? "border-azure-500 bg-azure-200/60 font-medium text-azure-600"
                  : "border-ink/8 bg-white/60 text-ink-soft hover:text-ink",
              )}
            >
              {f.key !== "all" && f.key !== "insufficient_data" && (
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: RISK_META[f.key].hex }}
                />
              )}
              {f.label}
              <span className="font-mono tnum text-[11px] opacity-70">{counts[f.key]}</span>
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={<Users size={22} />}
          title="No students match your filters"
          body="Try clearing the search or switching the risk filter."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] border-collapse">
            <thead>
              <tr className="border-b border-ink/8 bg-white/30">
                <th className="w-8" />
                <SortHeader label="Student" k="name" />
                <th className="px-3 py-2.5 text-center text-caption font-semibold uppercase tracking-wide text-ink-soft">
                  Signal
                </th>
                <SortHeader label="Score" k="score" />
                <SortHeader label="Status" k="risk" />
                <SortHeader label="Attend." k="attendance" className="hidden md:table-cell" />
                <th className="hidden px-3 py-2.5 text-left text-caption font-semibold uppercase tracking-wide text-ink-soft lg:table-cell">
                  Next meeting
                </th>
                <th className="px-3 py-2.5 text-right text-caption font-semibold uppercase tracking-wide text-ink-soft">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((entry) => {
                const isOpen = expanded === entry.student_id;
                const breakdown = toBreakdown(entry);
                return (
                  <Fragment key={entry.student_id}>
                    <tr
                      className={cn(
                        "border-b border-ink/8 transition-colors hover:bg-azure-200/20",
                        isOpen && "bg-azure-200/20",
                      )}
                    >
                      <td className="pl-3">
                        <button
                          type="button"
                          onClick={() => setExpanded(isOpen ? null : entry.student_id)}
                          aria-label={isOpen ? "Collapse row" : "Expand row"}
                          aria-expanded={isOpen}
                          className="rounded-sm p-1 text-ink-soft hover:bg-ink/4"
                        >
                          <ChevronDown size={16} className={cn("transition-transform", isOpen && "rotate-180")} />
                        </button>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={entry.full_name} hue={avatarHue(entry.student_id)} size="sm" />
                          <div className="min-w-0">
                            <div className="truncate text-body font-medium text-ink">{entry.full_name}</div>
                            <div className="font-mono tnum text-[11px] text-ink-soft">
                              {entry.usn} · Sem {entry.semester}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-center">
                          {breakdown ? (
                            <SignalDisc breakdown={breakdown} size="sm" countUp={false} />
                          ) : (
                            <NoValue />
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        {entry.success_score === null ? (
                          <NoValue />
                        ) : (
                          <span className="font-mono tnum text-[18px] font-semibold text-ink">
                            {Math.round(entry.success_score)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {entry.risk_status === "insufficient_data" ? (
                          <Badge tone="neutral">No data</Badge>
                        ) : (
                          <RiskBadge category={entry.risk_status} />
                        )}
                      </td>
                      <td className="hidden px-3 py-3 md:table-cell">
                        {entry.attendance_component === null ? (
                          <NoValue />
                        ) : (
                          <span className="font-mono tnum text-body text-ink">
                            {Math.round(entry.attendance_component)}%
                          </span>
                        )}
                      </td>
                      <td className="hidden px-3 py-3 lg:table-cell">
                        {entry.next_meeting ? (
                          <span className="text-caption text-ink">
                            {formatDate(entry.next_meeting.scheduled_for)}
                          </span>
                        ) : (
                          <span className="text-caption text-ink-soft">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onSchedule(entry)}
                            iconLeft={<CalendarPlus size={15} />}
                          >
                            <span className="hidden sm:inline">Schedule</span>
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => onLog(entry)}
                            iconLeft={<ClipboardCheck size={15} />}
                          >
                            <span className="hidden sm:inline">Log</span>
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {isOpen && <DetailRow entry={entry} />}

                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ComponentRow({ label, value }: { label: string; value: number | null }) {
  return (
    <li className="flex justify-between">
      <span>{label}</span>
      {value === null ? (
        <span className="text-ink-soft">—</span>
      ) : (
        <span className="font-mono tnum">{Math.round(value)}</span>
      )}
    </li>
  );
}

function DetailRow({ entry }: { entry: MentorRosterItem }) {
  const last = entry.last_meeting;
  return (
    <tr className="border-b border-ink/8 bg-white/40">
      <td />
      <td colSpan={7} className="px-3 py-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="mb-1 text-caption font-semibold uppercase tracking-wide text-ink-soft">
              Components
            </p>
            <ul className="space-y-0.5 text-caption text-ink">
              <ComponentRow label="Attendance" value={entry.attendance_component} />
              <ComponentRow label="Academic" value={entry.academic_component} />
              <ComponentRow label="Engagement" value={entry.engagement_component} />
              <ComponentRow label="Placement" value={entry.placement_component} />
            </ul>
            {entry.risk_status === "insufficient_data" && (
              <p className="mt-2 text-caption text-ink-soft">
                Not enough attendance or academic data to score this student.
              </p>
            )}
          </div>
          <div className="sm:col-span-2">
            <p className="mb-1 text-caption font-semibold uppercase tracking-wide text-ink-soft">
              Last meeting
            </p>
            {last?.log ? (
              <div className="text-caption text-ink">
                <p className="text-ink-soft">{daysAgoLabel(last.scheduled_for)}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {last.log.topics.map((t) => (
                    <Badge key={t} tone="azure">{t}</Badge>
                  ))}
                </div>
                {entry.open_action_items > 0 && (
                  <p className="mt-2 text-signal-amber">
                    {entry.open_action_items} open action item{entry.open_action_items > 1 ? "s" : ""}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-caption text-ink-soft">
                No meetings logged yet — schedule the first one to start a record.
              </p>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}
