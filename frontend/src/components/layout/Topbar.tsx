import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Menu, Sparkles } from "lucide-react";
import type { Role } from "@/types";
import { getMyStudentProfile } from "@/api";
import { useAppStore } from "@/store/useAppStore";
import { ROLE_TITLE } from "@/api/session";
import { Avatar } from "@/components/primitives/Avatar";
import { Button } from "@/components/primitives";
import { supabase } from "@/lib/supabase";

export function Topbar({ role, title }: { role: Role; title: string }) {
  const navigate = useNavigate();
  const { setSidebarOpen, toggleCompanion, session, user, setSession } = useAppStore();
  const signedIn = !!session || !!sessionStorage.getItem("token");
  const userName = user?.user_metadata?.full_name ?? user?.email ?? null;
  const userEmail = user?.email ?? null;
  const [profilePictureUrl, setProfilePictureUrl] = useState<string | null>(null);

  useEffect(() => {
    const refreshProfilePicture = () => {
      if (role !== "student" || !signedIn) {
        setProfilePictureUrl(null);
        return;
      }

      getMyStudentProfile().then((profile) => {
        setProfilePictureUrl(profile?.profile_picture_url ?? null);
      });
    };

    refreshProfilePicture();
    window.addEventListener("profile-picture-updated", refreshProfilePicture);
    return () => window.removeEventListener("profile-picture-updated", refreshProfilePicture);
  }, [role, signedIn]);

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error("Sign out failed", error);
    }
    setSession(null, null);
    sessionStorage.removeItem("token");
    localStorage.removeItem("sb-ozkqklyzjmlahlwehdmd-auth-token");
    navigate("/auth/login", { replace: true });
  };

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-ink/8 bg-snow/70 px-4 backdrop-blur-md sm:px-6">
      {/* Mobile menu toggle */}
      <button
        type="button"
        onClick={() => setSidebarOpen(true)}
        aria-label="Open menu"
        className="rounded-sm p-2 text-ink-soft hover:bg-ink/4 lg:hidden"
      >
        <Menu size={20} />
      </button>

      {/* Page title */}
      <div className="min-w-0 flex-1">
        <h1 className="truncate font-display text-[20px] font-semibold leading-tight text-ink">
          {title}
        </h1>
        <p className="hidden text-[11px] text-ink-soft sm:block">{ROLE_TITLE[role]} workspace</p>
      </div>

      {/* AI Companion shortcut — student only */}
      {role === "student" && (
        <button
          type="button"
          onClick={toggleCompanion}
          className="hidden items-center gap-2 rounded-full border border-azure-200 bg-azure-200/40 px-3 py-2 text-caption font-medium text-azure-600 transition-colors hover:bg-azure-200/70 sm:flex"
        >
          <Sparkles size={16} />
          AI Companion
        </button>
      )}

      {/* Auth state */}
      {signedIn ? (
        <div className="flex items-center gap-2">
          {/* Avatar + name pill */}
          <div className="hidden items-center gap-2.5 rounded-full border border-ink/8 bg-white/70 py-1.5 pl-1.5 pr-3 sm:flex">
            {profilePictureUrl ? (
              <img
                src={profilePictureUrl}
                alt={userName ?? userEmail ?? "Profile"}
                className="h-8 w-8 rounded-full border border-white object-cover"
              />
            ) : (
              <Avatar name={userName ?? userEmail ?? "U"} hue={214} size="sm" />
            )}
            <span className="hidden text-left leading-tight lg:block">
              <span className="block text-caption font-medium text-ink">{userName ?? userEmail}</span>
              <span className="block text-[11px] text-ink-soft">{ROLE_TITLE[role]}</span>
            </span>
          </div>
          <Button size="sm" variant="secondary" onClick={handleSignOut}>
            Sign out
          </Button>
        </div>
      ) : (
        <Button size="sm" onClick={() => navigate("/auth/login")}>
          Sign in
        </Button>
      )}
    </header>
  );
}
