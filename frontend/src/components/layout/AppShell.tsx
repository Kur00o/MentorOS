import { Suspense, useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import type { Role } from "@/types";
import { useAppStore } from "@/store/useAppStore";
import { LoadingState } from "@/components/primitives";
import { Toaster } from "@/components/Toaster";
import { CompanionDock } from "@/features/companion/CompanionDock";
import { CompanionButton } from "@/features/companion/CompanionButton";
import { Background } from "./Background";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

const PAGE_TITLE: Record<Role, string> = {
  student: "Your progress",
  mentor: "Mentee roster",
  hod: "Department overview",
  admin: "Administration",
};

function roleFromPath(pathname: string): Role | undefined {
  const seg = pathname.split("/")[2] as Role | undefined;
  return seg && ["student", "mentor", "hod", "admin"].includes(seg) ? seg : undefined;
}

export function AppShell() {
  const location = useLocation();
  const { activeRole, setActiveRole, setCompanionOpen } = useAppStore();

  // Keep the active identity in sync with the URL so deep links and the role
  // switcher agree. Close the companion when leaving the student dashboard.
  const urlRole = roleFromPath(location.pathname);
  useEffect(() => {
    if (urlRole && urlRole !== activeRole) setActiveRole(urlRole);
    if (urlRole && urlRole !== "student") setCompanionOpen(false);
  }, [urlRole, activeRole, setActiveRole, setCompanionOpen]);

  const role = urlRole ?? activeRole;

  return (
    <div className="relative min-h-screen">
      <Background variant="app" />
      <div className="flex">
        <Sidebar role={role} />
        <div className="flex min-h-screen w-full min-w-0 flex-col">
          <Topbar role={role} title={PAGE_TITLE[role]} />
          <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
            <div className="mx-auto w-full max-w-6xl">
              <Suspense fallback={<LoadingState label="Loading…" />}>
                <Outlet />
              </Suspense>
            </div>
          </main>
        </div>
      </div>
      <Toaster />
      <CompanionDock />
      <CompanionButton />
    </div>
  );
}
