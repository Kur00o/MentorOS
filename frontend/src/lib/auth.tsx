import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "./api";
import { supabase } from "./supabase";
import type { Me, Role } from "./types";

interface AuthState {
  status: "loading" | "signed_out" | "ready" | "error";
  session: Session | null;
  me: Me | null;
  error: ApiError | null;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export const homeFor = (role: Role) => ({ student: "/student", mentor: "/mentor", hod: "/hod", admin: "/admin" })[role];

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [status, setStatus] = useState<AuthState["status"]>(supabase ? "loading" : "signed_out");
  const [error, setError] = useState<ApiError | null>(null);

  const loadMe = useCallback(async (s: Session | null) => {
    if (!s) {
      setMe(null);
      setStatus("signed_out");
      return;
    }
    try {
      const profile = await api.get<Me>("/auth/me");
      setMe(profile);
      setError(null);
      setStatus("ready");
    } catch (e) {
      setMe(null);
      setError(e instanceof ApiError ? e : new ApiError(0, "error", "Could not load your profile"));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      loadMe(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") loadMe(s);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadMe]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      session,
      me,
      error,
      async signIn(email, password) {
        if (!supabase) throw new ApiError(0, "not_configured", "Sign-in is not configured for this deployment.");
        const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
        if (err) {
          const msg = /invalid login credentials/i.test(err.message) ? "That email and password don't match. Check for typos and try again." : err.message;
          throw new ApiError(err.status ?? 400, "auth_failed", msg);
        }
      },
      async signInWithGoogle() {
        if (!supabase) return;
        await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/auth/callback` } });
      },
      async signOut() {
        await supabase?.auth.signOut();
        qc.clear();
        setMe(null);
        setStatus("signed_out");
      },
      refreshMe: () => loadMe(session),
    }),
    [status, session, me, error, loadMe, qc],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
