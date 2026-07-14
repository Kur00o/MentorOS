import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Chrome, Eye, EyeOff, KeyRound, Lock, LogIn, Mail, XCircle } from "lucide-react";
import { Button } from "@/components/primitives";
import { Brand } from "@/components/Brand";
import { Background } from "@/components/layout/Background";
import { toast } from "@/store/useToast";
import { signInWithGoogle } from "@/lib/auth";
import { getMe, ROLE_HOME } from "@/api";
import { useAppStore } from "@/store/useAppStore";
import type { Role } from "@/types";

const ALLOWED_DOMAIN = "@mitwpu.edu.in";

type Screen = "login" | "set-password";

export default function Login() {
  const navigate = useNavigate();
  const setSession = useAppStore((s) => s.setSession);
  const [screen, setScreen] = useState<Screen>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function validateEmail(val: string): string | null {
    if (!val.trim()) return "Email is required.";
    if (!val.toLowerCase().endsWith(ALLOWED_DOMAIN))
      return `Only ${ALLOWED_DOMAIN} accounts are allowed.`;
    return null;
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const emailErr = validateEmail(email);
    if (emailErr) { setError(emailErr); return; }
    if (!password) { setError("Password is required."); return; }

    setLoading(true);
    try {
      const formData = new URLSearchParams();
      formData.append("username", email.trim().toLowerCase());
      formData.append("password", password);

      const resp = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData,
      });
      const data = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        // First-time login — account exists but no password set yet
        if (data?.detail === "first_login") {
          setScreen("set-password");
          setPassword("");
          setLoading(false);
          return;
        }
        setError(data?.detail || "Incorrect email or password.");
        setLoading(false);
        return;
      }

      if (data?.access_token) {
        sessionStorage.setItem("token", data.access_token);
        try {
          const me = await getMe();
          setSession(null, {
            id: String(me.id),
            email: me.email,
            user_metadata: { full_name: me.full_name },
            role: me.role.toLowerCase(),
          } as any);
          toast.success("Welcome back!");
          navigate(ROLE_HOME[me.role.toLowerCase() as Role] || "/app/student");
        } catch (err) {
          console.error("Failed to fetch user me on login:", err);
          toast.success("Welcome back!");
          navigate("/app/student");
        }
      }
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    setError(null);
    setGoogleLoading(true);
    try {
      const { error } = await signInWithGoogle();
      if (error) {
        throw error;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not continue with Google.");
    } finally {
      setGoogleLoading(false);
    }
  }

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const resp = await fetch("/api/v1/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), new_password: newPassword }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setError(data?.detail || "Could not set password.");
        setLoading(false);
        return;
      }
      if (data?.access_token) {
        sessionStorage.setItem("token", data.access_token);
        toast.success("Password set. Welcome to MentorOS!");
        navigate("/app/student");
      }
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen flex flex-col overflow-x-clip">
      <Background variant="landing" />

      <header className="sticky top-0 z-30 border-b border-white/40 bg-snow/70 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <button onClick={() => navigate("/")} aria-label="MentorOS home" className="rounded-sm">
            <Brand />
          </button>
          <Button onClick={() => navigate("/")} variant="secondary" iconLeft={<ArrowLeft size={16} />}>
            Back to Home
          </Button>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-md rounded-3xl border border-ink/8 bg-white/70 p-8 shadow-glass-strong backdrop-blur-md"
        >
          <AnimatePresence mode="wait">
            {screen === "login" ? (
              <motion.div
                key="login"
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 16 }}
                transition={{ duration: 0.2 }}
              >
                <div className="mb-8 text-center">
                  <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
                    Sign in to MentorOS
                  </h1>
                  <p className="mt-2 text-caption text-ink-soft">
                    Use your <span className="font-medium text-ink">{ALLOWED_DOMAIN}</span> account
                  </p>
                </div>

                <form onSubmit={handleSignIn} className="space-y-4">
                  {error && (
                    <div className="flex items-start gap-2 rounded-lg border border-signal-coral/30 bg-signal-coral/10 p-3 text-caption text-signal-coral">
                      <XCircle size={15} className="mt-px shrink-0" />
                      {error}
                    </div>
                  )}

                  <div className="flex flex-col gap-1.5">
                    <label className="text-caption font-medium text-ink-soft" htmlFor="email">
                      Institutional email
                    </label>
                    <div className="flex items-center gap-2 rounded-md border border-ink/12 bg-white/60 px-3 py-2.5 focus-within:border-azure-400 focus-within:ring-1 focus-within:ring-azure-400/30">
                      <Mail size={15} className="shrink-0 text-ink-soft" />
                      <input
                        id="email"
                        type="email"
                        placeholder={`you${ALLOWED_DOMAIN}`}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        disabled={loading}
                        className="min-w-0 flex-1 bg-transparent text-body text-ink placeholder:text-ink-soft/50 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-caption font-medium text-ink-soft" htmlFor="password">
                      Password
                    </label>
                    <div className="flex items-center gap-2 rounded-md border border-ink/12 bg-white/60 px-3 py-2.5 focus-within:border-azure-400 focus-within:ring-1 focus-within:ring-azure-400/30">
                      <Lock size={15} className="shrink-0 text-ink-soft" />
                      <input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={loading}
                        className="min-w-0 flex-1 bg-transparent text-body text-ink placeholder:text-ink-soft/50 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="shrink-0 text-ink-soft hover:text-ink"
                        tabIndex={-1}
                      >
                        {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                  </div>

                  <Button type="submit" block disabled={loading} iconRight={<LogIn size={16} />} className="h-11">
                    {loading ? "Signing in…" : "Sign in"}
                  </Button>
                </form>

                <div className="mt-6 flex items-center gap-3">
                  <div className="h-px flex-1 bg-ink/10" />
                  <span className="text-caption text-ink-soft">or</span>
                  <div className="h-px flex-1 bg-ink/10" />
                </div>

                <Button
                  type="button"
                  block
                  variant="secondary"
                  disabled={googleLoading || loading}
                  iconLeft={<Chrome size={16} />}
                  className="mt-4 h-11"
                  onClick={handleGoogleSignIn}
                >
                  {googleLoading ? "Redirecting…" : "Continue with Google"}
                </Button>

                <p className="mt-4 text-center text-caption text-ink-soft">
                  Only <span className="font-medium text-ink">{ALLOWED_DOMAIN}</span> Google accounts are accepted.
                </p>

                <p className="mt-6 text-center text-caption text-ink-soft">
                  First time signing in? Enter your email and password — if your account has been set up by the institution, you'll be prompted to create a password.
                </p>
              </motion.div>
            ) : (
              <motion.div
                key="set-password"
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.2 }}
              >
                <div className="mb-8 text-center">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-azure-200/60">
                    <KeyRound size={22} className="text-azure-600" />
                  </div>
                  <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
                    Create your password
                  </h1>
                  <p className="mt-2 text-caption text-ink-soft">
                    First time signing in as <span className="font-medium text-ink">{email}</span>.
                    Set a password to continue.
                  </p>
                </div>

                <form onSubmit={handleSetPassword} className="space-y-4">
                  {error && (
                    <div className="flex items-start gap-2 rounded-lg border border-signal-coral/30 bg-signal-coral/10 p-3 text-caption text-signal-coral">
                      <XCircle size={15} className="mt-px shrink-0" />
                      {error}
                    </div>
                  )}

                  <div className="flex flex-col gap-1.5">
                    <label className="text-caption font-medium text-ink-soft" htmlFor="new-password">
                      New password
                    </label>
                    <div className="flex items-center gap-2 rounded-md border border-ink/12 bg-white/60 px-3 py-2.5 focus-within:border-azure-400 focus-within:ring-1 focus-within:ring-azure-400/30">
                      <Lock size={15} className="shrink-0 text-ink-soft" />
                      <input
                        id="new-password"
                        type="password"
                        placeholder="At least 8 characters"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        disabled={loading}
                        className="min-w-0 flex-1 bg-transparent text-body text-ink placeholder:text-ink-soft/50 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-caption font-medium text-ink-soft" htmlFor="confirm-password">
                      Confirm password
                    </label>
                    <div className="flex items-center gap-2 rounded-md border border-ink/12 bg-white/60 px-3 py-2.5 focus-within:border-azure-400 focus-within:ring-1 focus-within:ring-azure-400/30">
                      <Lock size={15} className="shrink-0 text-ink-soft" />
                      <input
                        id="confirm-password"
                        type="password"
                        placeholder="Re-enter password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        disabled={loading}
                        className="min-w-0 flex-1 bg-transparent text-body text-ink placeholder:text-ink-soft/50 focus:outline-none"
                      />
                    </div>
                  </div>

                  <Button type="submit" block disabled={loading} iconRight={<KeyRound size={16} />} className="h-11">
                    {loading ? "Setting password…" : "Set password & sign in"}
                  </Button>

                  <button
                    type="button"
                    onClick={() => { setScreen("login"); setError(null); setNewPassword(""); setConfirmPassword(""); }}
                    className="w-full text-caption text-ink-soft hover:text-ink"
                  >
                    ← Back to sign in
                  </button>
                </form>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </main>

      <footer className="border-t border-white/50 bg-snow/70 py-6 text-center text-caption text-ink-soft backdrop-blur-md">
        <p>© {new Date().getFullYear()} MentorOS · MIT World Peace University</p>
      </footer>
    </div>
  );
}
