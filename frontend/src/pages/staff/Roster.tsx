import { useEffect, useState } from "react";
import { Download, Search } from "lucide-react";
import { download } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { BAND } from "@/lib/format";
import { useDepartments, useStudents, type StudentQuery } from "@/lib/queries";
import type { Band } from "@/lib/types";
import { Button, Empty, ErrorNote, Input, PageHeader, Segmented, Select, Sheet, Skeleton } from "@/ui/core";
import { RosterTable, type SortKey } from "@/features/students/RosterTable";

export default function Roster() {
  const { me } = useAuth();
  const role = me!.role;
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [band, setBand] = useState<"all" | Band>("all");
  const [semester, setSemester] = useState<number | undefined>();
  const [dept, setDept] = useState<number | undefined>();
  const [unassigned, setUnassigned] = useState(false);
  const [sort, setSort] = useState<SortKey>("score");
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  useEffect(() => { const t = setTimeout(() => { setDebounced(q); setPage(1); }, 250); return () => clearTimeout(t); }, [q]);
  const params: StudentQuery = { q: debounced, band: band === "all" ? undefined : band, semester, department_id: dept, unassigned, sort, order, page, page_size: 50 };
  const { data, isLoading, error, refetch, isFetching } = useStudents(params);
  const depts = useDepartments(role === "admin");
  const onSort = (k: SortKey) => { if (k === sort) setOrder(order === "asc" ? "desc" : "asc"); else { setSort(k); setOrder(k === "name" ? "asc" : "asc"); } };
  const title = role === "mentor" ? "Your mentees" : role === "hod" ? "Department students" : "All students";
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  return (
    <>
      <PageHeader eyebrow={role === "mentor" ? "Roster" : "Students"} title={title} sub="Sorted lowest score first so the students who need you lead the list."
        actions={<Button icon={<Download size={15} />} onClick={() => download(`/admin/exports/students${band !== "all" ? `?band=${band}` : ""}`, "mentoros_students.csv")}>Export CSV</Button>} />
      <Sheet pad={false}>
        <div className="flex flex-col gap-3 border-b border-rule/10 p-4 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-graphite" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, USN or email" className="pl-9" aria-label="Search students" />
          </div>
          <Segmented layoutId="band-filter" value={band} onChange={(v) => { setBand(v); setPage(1); }}
            options={[{ value: "all", label: "All" }, ...(["coral", "amber", "green", "insufficient_data"] as Band[]).map((b) => ({ value: b, label: BAND[b].short }))]} />
          <Select value={semester ?? ""} onChange={(e) => { setSemester(Number(e.target.value) || undefined); setPage(1); }} className="lg:w-36" aria-label="Semester">
            <option value="">All semesters</option>{[1, 3, 5, 7].map((s) => <option key={s} value={s}>Semester {s}</option>)}
          </Select>
          {role === "admin" && (
            <Select value={dept ?? ""} onChange={(e) => { setDept(Number(e.target.value) || undefined); setPage(1); }} className="lg:w-44" aria-label="Department">
              <option value="">All departments</option>{depts.data?.map((d) => <option key={d.id} value={d.id}>{d.code}</option>)}
            </Select>
          )}
          {role !== "mentor" && (
            <label className="flex items-center gap-2 whitespace-nowrap text-[13px]"><input type="checkbox" checked={unassigned} onChange={(e) => { setUnassigned(e.target.checked); setPage(1); }} className="accent-[rgb(var(--pen))]" />Unassigned only</label>
          )}
        </div>
        {error ? <div className="p-4"><ErrorNote error={error} retry={() => refetch()} /></div> : isLoading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : data!.items.length ? (
          <div className={isFetching ? "opacity-70 transition-opacity" : ""}>
            <RosterTable rows={data!.items} sort={sort} order={order} onSort={onSort} showMentor={role !== "mentor"} showDept={role === "admin"} />
          </div>
        ) : <Empty title="No students match" body="Try clearing a filter." />}
        {data && data.total > data.page_size && (
          <div className="flex items-center justify-between border-t border-rule/10 px-4 py-3 text-sm">
            <span className="text-graphite">{data.total} students · page {page} of {pages}</span>
            <div className="flex gap-2"><Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button></div>
          </div>
        )}
        {data && data.total <= data.page_size && <div className="border-t border-rule/10 px-4 py-3 text-sm text-graphite">{data.total} student{data.total === 1 ? "" : "s"}</div>}
      </Sheet>
    </>
  );
}
