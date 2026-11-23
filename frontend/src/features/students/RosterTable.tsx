import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp } from "lucide-react";
import { motion } from "motion/react";
import { useAuth } from "@/lib/auth";
import { BAND, cn, date, num } from "@/lib/format";
import type { StudentRow } from "@/lib/types";
import { Avatar, BandChip, Delta, EASE } from "@/ui/core";
import { MicroTrace } from "@/ui/charts";

export type SortKey = "score" | "attendance" | "cgpa" | "name" | "delta" | "semester";

function Th({ label, k, sort, order, onSort, className }: { label: string; k?: SortKey; sort?: string; order?: string; onSort?: (k: SortKey) => void; className?: string }) {
  const active = k && sort === k;
  return (
    <th className={cn("whitespace-nowrap px-3 py-2.5 text-left font-normal", className)}>
      {k && onSort ? (
        <button onClick={() => onSort(k)} className={cn("readout inline-flex items-center gap-1 hover:text-ink", active && "!text-ink")}>
          {label}{active && (order === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
        </button>
      ) : <span className="readout">{label}</span>}
    </th>
  );
}

export function RosterTable({ rows, sort, order, onSort, showMentor, showDept, dense }: {
  rows: StudentRow[]; sort?: string; order?: string; onSort?: (k: SortKey) => void; showMentor?: boolean; showDept?: boolean; dense?: boolean;
}) {
  const { me } = useAuth();
  const base = `/${me?.role}`;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-sm">
        <thead className="border-b border-rule/10">
          <tr>
            <Th label="Student" k="name" sort={sort} order={order} onSort={onSort} />
            <Th label="Trace" />
            <Th label="Score" k="score" sort={sort} order={order} onSort={onSort} />
            <Th label="Δ" k="delta" sort={sort} order={order} onSort={onSort} />
            <Th label="Attendance" k="attendance" sort={sort} order={order} onSort={onSort} />
            <Th label="CGPA" k="cgpa" sort={sort} order={order} onSort={onSort} />
            {showDept && <Th label="Dept" />}
            {showMentor && <Th label="Mentor" />}
            <Th label="Alerts" />
            <Th label="Last met" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <motion.tr key={r.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, delay: Math.min(i, 20) * 0.015, ease: EASE }}
              className="group border-b border-rule/[0.07] transition-colors hover:bg-sheet-raised">
              <td className={cn("px-3", dense ? "py-2" : "py-3")}>
                <Link to={`${base}/students/${r.id}`} className="flex items-center gap-3">
                  <Avatar name={r.name} src={r.avatar_url} size={dense ? 28 : 34} ring={r.band} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium group-hover:text-pen">{r.name}</span>
                    <span className="block font-mono text-[10px] tracking-wide text-graphite">{r.usn} · S{r.semester}{r.section ?? ""}</span>
                  </span>
                </Link>
              </td>
              <td className="px-3"><MicroTrace values={r.sparkline} band={r.band} /></td>
              <td className="px-3"><BandChip band={r.band} score={r.score} size="sm" showLabel={false} /></td>
              <td className="px-3 text-xs"><Delta value={r.delta} /></td>
              <td className={cn("tnum px-3", r.attendance_pct != null && r.attendance_pct < 75 && "font-semibold text-critical")}>{num(r.attendance_pct, 0)}%</td>
              <td className="tnum px-3">{num(r.cgpa, 2)}</td>
              {showDept && <td className="px-3 text-xs text-graphite">{r.department}</td>}
              {showMentor && <td className="px-3 text-xs">{r.mentor?.name ?? <span className="text-watch">Unassigned</span>}</td>}
              <td className="px-3">
                {r.open_alerts ? (
                  <span className="inline-flex items-center gap-1 text-xs">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: r.high_alerts ? BAND.coral.ink : BAND.amber.ink }} />
                    {r.open_alerts}{r.high_alerts ? <span className="text-critical">· {r.high_alerts} high</span> : null}
                  </span>
                ) : <span className="text-xs text-graphite-light">—</span>}
              </td>
              <td className="whitespace-nowrap px-3 text-xs text-graphite">{date(r.last_meeting_at)}{r.next_meeting_at && <span className="ml-1 text-pen">→ {date(r.next_meeting_at)}</span>}</td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
