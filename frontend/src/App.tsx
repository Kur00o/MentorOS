import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { LoadingState } from "@/components/primitives";
import { useAppStore } from "@/store/useAppStore";
import { supabase } from "@/lib/supabase";
import { loginToBackend } from "@/lib/auth";
import { Toaster } from "@/components/Toaster";
import { getMe } from "@/api";

// Route-level code splitting — the landing page no longer pulls in Recharts
// (HOD) or the heavier dashboard code until those routes are visited.
const Landing = lazy(() => import("@/pages/auth/Landing"));
const Login = lazy(() => import("@/pages/auth/Login"));
const Callback = lazy(() => import("@/pages/auth/Callback"));
const AdminCreateUsers = lazy(() => import("@/pages/admin/AdminCreateUsers"));
const StudentDashboard = lazy(() => import("@/pages/student/StudentDashboard"));
const AttendancePage = lazy(() => import("@/pages/student/AttendancePage"));
const MeetingsPage = lazy(() => import("@/pages/student/MeetingsPage"));
const ProfilePage = lazy(() => import("@/pages/student/ProfilePage"));
const ConsentPage = lazy(() => import("@/pages/student/ConsentPage"));
const MentorDashboard = lazy(() => import("@/pages/mentor/MentorDashboard"));
const HODDashboard = lazy(() => import("@/pages/admin/HODDashboard"));
const AdminDashboard = lazy(() => import("@/pages/admin/AdminDashboard"));

function FullScreenFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-snow">
      <LoadingState label="Loading MentorOS…" />
    </div>
  );
}

export default function App() {
  const { setSession, setAuthLoading, authLoading } = useAppStore();

  useEffect(() => {
    async function initAuth() {
      try {
        setAuthLoading(true);
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) throw error;

        const storedToken = sessionStorage.getItem("token");
        if (storedToken) {
          try {
            const me = await getMe();
            setSession(null, {
              id: String(me.id),
              email: me.email,
              user_metadata: { full_name: me.full_name },
              role: me.role.toLowerCase(),
            } as any);
          } catch (err) {
            console.error("Failed to restore session me:", err);
            setSession(null, { email: "signed-in" } as any);
          }
        } else if (session) {
          setSession(session, session.user);
          const token = sessionStorage.getItem("token");
          if (!token && session.access_token) {
            try {
              await loginToBackend(session.access_token);
            } catch (err) {
              console.error("Backend token restore failed:", err);
            }
          }
        } else {
          setSession(null, null);
        }
      } catch (err) {
        console.error("Failed to restore session on mount:", err);
        setSession(null, null);
      } finally {
        setAuthLoading(false);
      }
    }

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session) {
        setSession(session, session.user);
        const token = sessionStorage.getItem("token");
        if (!token && session.access_token) {
          try {
            await loginToBackend(session.access_token);
          } catch (err) {
            console.error("Backend token refresh on auth change failed:", err);
          }
        }
      } else {
        setSession(null, null);
        sessionStorage.removeItem("token");
      }
      setAuthLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [setSession, setAuthLoading]);

  if (authLoading) {
    return <FullScreenFallback />;
  }

  return (
    <>
      <Suspense fallback={<FullScreenFallback />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/auth/login" element={<Login />} />
          <Route path="/auth/callback" element={<Callback />} />
          <Route path="/app" element={<AppShell />}>
            <Route index element={<Navigate to="/app/mentor" replace />} />
            <Route path="student" element={<StudentDashboard />} />
            <Route path="student/attendance" element={<AttendancePage />} />
            <Route path="student/meetings" element={<MeetingsPage />} />
            <Route path="student/profile" element={<ProfilePage />} />
            <Route path="student/consent" element={<ConsentPage />} />
            <Route path="mentor" element={<MentorDashboard />} />
            <Route path="hod" element={<HODDashboard />} />
            <Route path="admin" element={<AdminDashboard />} />
            <Route path="admin/create-users" element={<AdminCreateUsers />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <Toaster />
    </>
  );
}
