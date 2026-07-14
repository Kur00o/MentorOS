import { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Check, ChevronDown, LogOut, X } from "lucide-react";
import type { Role } from "@/types";
import { useAppStore } from "@/store/useAppStore";
import { ROLE_HOME, ROLE_TITLE, resolveIdentity } from "@/api/session";
import { Avatar } from "@/components/primitives/Avatar";
import { Brand } from "@/components/Brand";
import { NAV } from "./nav";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";

const ROLE_ORDER: Role[] = ["student", "mentor", "hod", "admin"];

const ROLE_BLURB: Record<Role, string> = {
  student: "See your own Success Score",
  mentor: "Roster, meetings & logs",
  hod: "Department-wide risk view",
  admin: "Users, imports & exports",
};

/** Collapsed demo role switcher for the sidebar footer */
function DemoRoleSwitcher({ role: _role }: { role: Role }) {
  const navigate = useNavigate();
  const { activeRole, setActiveRole } = useAppStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  function choose(r: Role) {
    setActiveRole(r);
    setOpen(false);
    navigate(ROLE_HOME[r]);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-caption text-ink-soft transition-colors hover:bg-ink/4 hover:text-ink"
      >
        <ChevronDown size={14} className={cn("shrink-0 transition-transform", open && "rotate-180")} />
        <span className="text-[11px] uppercase tracking-wide font-medium">Demo: Switch view</span>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 right-0 mb-1 rounded-md border border-ink/8 bg-white/95 p-1.5 shadow-lg backdrop-blur-sm">
          <p className="px-2 pb-1.5 pt-1 text-[10px] uppercase tracking-wide font-medium text-ink-soft/70">
            Viewing as
          </p>
          {ROLE_ORDER.map((r) => {
            const id = resolveIdentity(r);
            const active = r === activeRole;
            return (
              <button
                key={r}
                onClick={() => choose(r)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left transition-colors",
                  active ? "bg-azure-200/45" : "hover:bg-ink/4",
                )}
              >
                <Avatar name={id.name} hue={id.hue} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block text-caption font-medium text-ink">{ROLE_TITLE[r]}</span>
                  <span className="block truncate text-[11px] text-ink-soft">{ROLE_BLURB[r]}</span>
                </span>
                {active && <Check size={14} className="shrink-0 text-azure-600" />}
              </button>
            );
          })}
          <p className="px-2 pb-1 pt-1.5 text-[10px] text-ink-soft/70">
            Demo only — no login required.
          </p>
        </div>
      )}
    </div>
  );
}

function NavList({ role, onNavigate }: { role: Role; onNavigate?: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const toggleCompanion = useAppStore((s) => s.toggleCompanion);

  return (
    <nav className="flex flex-col gap-1" aria-label={`${ROLE_TITLE[role]} navigation`}>
      {NAV[role].map((item) => {
        const Icon = item.icon;
        // Active if the current pathname matches the item's route exactly,
        // or for anchor-only items (no subroute), if it starts with the base path.
        const isActive = item.action
          ? false
          : item.to === location.pathname ||
            (item.anchor && location.pathname === item.to);

        return (
          <button
            key={item.label}
            type="button"
            onClick={() => {
              if (item.action === "companion") {
                toggleCompanion();
              } else {
                navigate(item.to);
                if (item.anchor) {
                  window.setTimeout(() => {
                    const el = document.getElementById(item.anchor!);
                    el?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }, 60);
                }
              }
              onNavigate?.();
            }}
            className={cn(
              "group flex items-center gap-3 rounded-sm px-3 py-2.5 text-left text-body transition-colors",
              isActive
                ? "bg-azure-200/55 font-medium text-azure-600"
                : "text-ink-soft hover:bg-ink/4 hover:text-ink",
            )}
          >
            <Icon
              size={18}
              className={cn("shrink-0", isActive ? "text-azure-600" : "text-ink-soft group-hover:text-ink")}
            />
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}

function SidebarBody({ role, onNavigate }: { role: Role; onNavigate?: () => void }) {
  const navigate = useNavigate();
  const { session, user } = useAppStore();

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error("Sign out failed", error);
    }
    useAppStore.getState().setSession(null, null);
    sessionStorage.removeItem("token");
    localStorage.removeItem("sb-ozkqklyzjmlahlwehdmd-auth-token");
    navigate("/auth/login", { replace: true });
    onNavigate?.();
  };

  return (
    <div className="flex h-full flex-col gap-6 p-5">
      <button
        type="button"
        onClick={() => {
          navigate("/");
          onNavigate?.();
        }}
        className="w-fit rounded-sm focus-visible:outline-2 focus-visible:outline-azure-500"
        aria-label="MentorOS home"
      >
        <Brand />
      </button>

      <div className="text-caption font-medium uppercase tracking-wide text-ink-soft/70">
        {ROLE_TITLE[role]} workspace
      </div>

      <NavList role={role} onNavigate={onNavigate} />

      <div className="mt-auto space-y-4">
        {session && user && (
          <div className="border-t border-ink/8 pt-4">
            <div className="px-3 pb-2">
              <p className="text-[10px] uppercase tracking-wider text-ink-soft font-semibold">Logged In As</p>
              <p className="truncate text-caption text-ink font-medium" title={user.email}>{user.email}</p>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-caption text-signal-coral hover:bg-signal-coral/10 transition-colors"
            >
              <LogOut size={15} />
              Sign out
            </button>
          </div>
        )}

        {/* Demo role switcher */}
        <div className="border-t border-ink/8 pt-3">
          <DemoRoleSwitcher role={role} />
        </div>

        <button
          type="button"
          onClick={() => {
            navigate("/");
            onNavigate?.();
          }}
          className="flex items-center gap-2 rounded-sm px-3 py-2 text-caption text-ink-soft transition-colors hover:bg-ink/4 hover:text-ink w-full"
        >
          <ArrowLeft size={15} />
          Back to landing page
        </button>
      </div>
    </div>
  );
}

export function Sidebar({ role }: { role: Role }) {
  const { sidebarOpen, setSidebarOpen } = useAppStore();

  return (
    <>
      {/* Desktop rail */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-ink/8 bg-white/55 backdrop-blur-md lg:block">
        <SidebarBody role={role} />
      </aside>

      {/* Mobile drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-ink/30 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
            aria-hidden
          />
          <aside className="absolute left-0 top-0 h-full w-72 animate-fade-up bg-snow shadow-glass-strong">
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              aria-label="Close menu"
              className="absolute right-3 top-3 rounded-sm p-1.5 text-ink-soft hover:bg-ink/4"
            >
              <X size={20} />
            </button>
            <SidebarBody role={role} onNavigate={() => setSidebarOpen(false)} />
          </aside>
        </div>
      )}
    </>
  );
}
