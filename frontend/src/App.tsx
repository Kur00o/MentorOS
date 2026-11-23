import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { homeFor, useAuth } from "@/lib/auth";
import type { Role } from "@/lib/types";
import { Shell, Wordmark } from "@/app/Shell";
import { Button, Skeleton } from "@/ui/core";

const Landing = lazy(() => import("@/pages/public/Landing"));
const Login = lazy(() => import("@/pages/public/Login"));
const StudentHome = lazy(() => import("@/pages/student/StudentHome"));
const StudentAttendance = lazy(() => import("@/pages/student/StudentAttendance"));
const StudentAcademics = lazy(() => import("@/pages/student/StudentAcademics"));
const StudentMeetings = lazy(() => import("@/pages/student/StudentMeetings"));
const StudentPlacement = lazy(() => import("@/pages/student/StudentPlacement"));
const StudentProfile = lazy(() => import("@/pages/student/StudentProfile"));
const MentorToday = lazy(() => import("@/pages/mentor/MentorToday"));
const Roster = lazy(() => import("@/pages/staff/Roster"));
const StudentDetail = lazy(() => import("@/pages/staff/StudentDetail"));
const MeetingsBoard = lazy(() => import("@/pages/staff/MeetingsBoard"));
const AlertsBoard = lazy(() => import("@/pages/staff/AlertsBoard"));
const DepartmentAnalytics = lazy(() => import("@/pages/hod/DepartmentAnalytics"));
const Allocation = lazy(() => import("@/pages/hod/Allocation"));
const DataReports = lazy(() => import("@/pages/staff/DataReports"));
const AdminHome = lazy(() => import("@/pages/admin/AdminHome"));
const People = lazy(() => import("@/pages/admin/People"));
const Integrations = lazy(() => import("@/pages/admin/Integrations"));
const AuditLog = lazy(() => import("@/pages/admin/AuditLog"));

function Splash() {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="flex flex-col items-center gap-4">
        <Wordmark />
        <Skeleton className="h-1 w-40" />
      </div>
    </div>
  );
}

function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { status, me, error, signOut } = useAuth();
  const location = useLocation();
  if (status === "loading") return <Splash />;
  if (status === "signed_out") return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (status === "error" || !me) {
    return (
      <div className="mx-auto grid min-h-[70vh] max-w-md place-items-center px-6 text-center">
        <div>
          <Wordmark />
          <h1 className="mt-8 font-display text-3xl">We couldn’t open your desk</h1>
          <p className="mt-2 text-graphite">{error?.message ?? "Your profile could not be loaded."}</p>
          <Button className="mt-6" variant="ink" onClick={() => signOut()}>Sign out and try another account</Button>
        </div>
      </div>
    );
  }
  if (!roles.includes(me.role)) return <Navigate to={homeFor(me.role)} replace />;
  return <>{children}</>;
}

function NotFound() {
  return (
    <div className="grid min-h-[70vh] place-items-center px-6 text-center">
      <div>
        <div className="readout">404 · no signal</div>
        <h1 className="mt-3 font-display text-[4rem] leading-none tracking-[-0.04em]">Flatline.</h1>
        <p className="mt-3 text-graphite">This page doesn’t exist — or it moved.</p>
        <a href="/" className="mt-6 inline-block"><Button variant="ink">Back to MentorOS</Button></a>
      </div>
    </div>
  );
}

function Callback() {
  const { status, me } = useAuth();
  if (status === "ready" && me) return <Navigate to={homeFor(me.role)} replace />;
  if (status === "signed_out" || status === "error") return <Navigate to="/login" replace />;
  return <Splash />;
}

const staff = (r: Role) => r === "admin" ? ["admin"] as Role[] : [r];

export default function App() {
  return (
    <Suspense fallback={<Splash />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/auth/callback" element={<Callback />} />

        <Route element={<RequireRole roles={["student"]}><Shell /></RequireRole>}>
          <Route path="/student" element={<StudentHome />} />
          <Route path="/student/attendance" element={<StudentAttendance />} />
          <Route path="/student/academics" element={<StudentAcademics />} />
          <Route path="/student/meetings" element={<StudentMeetings />} />
          <Route path="/student/placement" element={<StudentPlacement />} />
          <Route path="/student/profile" element={<StudentProfile />} />
        </Route>

        <Route element={<RequireRole roles={staff("mentor")}><Shell /></RequireRole>}>
          <Route path="/mentor" element={<MentorToday />} />
          <Route path="/mentor/mentees" element={<Roster />} />
          <Route path="/mentor/students/:id" element={<StudentDetail />} />
          <Route path="/mentor/meetings" element={<MeetingsBoard />} />
          <Route path="/mentor/alerts" element={<AlertsBoard />} />
        </Route>

        <Route element={<RequireRole roles={staff("hod")}><Shell /></RequireRole>}>
          <Route path="/hod" element={<DepartmentAnalytics />} />
          <Route path="/hod/students" element={<Roster />} />
          <Route path="/hod/students/:id" element={<StudentDetail />} />
          <Route path="/hod/allocation" element={<Allocation />} />
          <Route path="/hod/alerts" element={<AlertsBoard />} />
          <Route path="/hod/meetings" element={<MeetingsBoard />} />
          <Route path="/hod/reports" element={<DataReports />} />
        </Route>

        <Route element={<RequireRole roles={["admin"]}><Shell /></RequireRole>}>
          <Route path="/admin" element={<AdminHome />} />
          <Route path="/admin/users" element={<People />} />
          <Route path="/admin/students" element={<Roster />} />
          <Route path="/admin/students/:id" element={<StudentDetail />} />
          <Route path="/admin/analytics" element={<DepartmentAnalytics />} />
          <Route path="/admin/allocation" element={<Allocation />} />
          <Route path="/admin/data" element={<DataReports />} />
          <Route path="/admin/integrations" element={<Integrations />} />
          <Route path="/admin/audit" element={<AuditLog />} />
        </Route>

        <Route path="/meetings" element={<RoleRedirect suffix="/meetings" />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

function RoleRedirect({ suffix }: { suffix: string }) {
  const { me, status } = useAuth();
  if (status === "loading") return <Splash />;
  if (!me) return <Navigate to="/login" replace />;
  return <Navigate to={`/${me.role}${suffix}`} replace />;
}
