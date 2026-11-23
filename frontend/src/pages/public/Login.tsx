import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { ArrowRight, KeyRound } from "lucide-react";
import { homeFor, useAuth } from "@/lib/auth";
import { authConfigured, googleEnabled } from "@/lib/supabase";
import { Button, EASE, Field, Input } from "@/ui/core";
import { Wordmark } from "@/app/Shell";

const DEMO = [
  { role: "Student", email: "student@mentoros.demo", who: "Aarav Kulkarni · CSE sem 5" },
  { role: "Mentor", email: "mentor@mentoros.demo", who: "Dr. Meera Iyer · CSE" },
  { role: "HOD", email: "hod@mentoros.demo", who: "Dr. Rajesh Deshpande · CSE" },
  { role: "Admin", email: "admin@mentoros.demo", who: "Ananya Rao · Institution" },
];

export default function Login() {
  const { signIn, signInWithGoogle, status, me, error: authError, signOut } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (status === "ready" && me) navigate(homeFor(me.role), { replace: true }); }, [status, me, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.includes("@")) return setError("Enter the email address your institute registered.");
    if (password.length < 6) return setError("Enter your password.");
    setBusy(true);
    try {
      await signIn(email, password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-[100dvh] lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-ink p-12 text-paper lg:flex lg:flex-col">
        <Link to="/" className="text-paper"><Wordmark /></Link>
        <div className="mt-auto">
          <svg viewBox="0 0 600 160" className="mb-10 w-full" aria-hidden>
            <motion.path d="M0 90 C60 70 90 100 140 84 S220 60 260 88 S330 150 380 128 S440 60 500 70 S560 64 600 58" fill="none" stroke="rgb(var(--paper))" strokeOpacity={0.9} strokeWidth={2}
              initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 2.4, ease: [0.65, 0, 0.35, 1] }} />
            <motion.circle cx={380} cy={128} r={26} fill="none" stroke="rgb(var(--pen))" strokeWidth={2} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 1.8, duration: 0.8 }} />
          </svg>
          <p className="font-display text-[3.2rem] leading-[0.95] tracking-[-0.04em]">The instrument is<br /><span className="italic text-pen-wash">listening.</span></p>
          <p className="mt-4 max-w-md text-paper/60">Sign in with the account your institute created for you. MentorOS never creates accounts on its own.</p>
        </div>
      </aside>
      <main className="flex flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between lg:justify-end">
          <Link to="/" className="lg:hidden"><Wordmark /></Link>
          <Link to="/" className="link-draw text-sm text-graphite">Back to home</Link>
        </div>
        <motion.div className="m-auto w-full max-w-[400px] py-10" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: EASE }}>
          <h1 className="font-display text-[2.6rem] leading-none tracking-[-0.035em]">Sign in</h1>
          <p className="mt-2 text-sm text-graphite">Students, mentors, HODs and admins all start here.</p>

          {!authConfigured && <div className="mt-6 rounded-md bg-watch-wash px-4 py-3 text-sm text-watch">Sign-in isn’t configured for this deployment (missing Supabase keys).</div>}
          {status === "error" && authError && (
            <div className="mt-6 rounded-md bg-critical-wash px-4 py-3 text-sm text-critical">
              {authError.message}
              <button className="ml-2 underline" onClick={() => signOut()}>Use another account</button>
            </div>
          )}

          <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
            <Field label="Email" htmlFor="email"><Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@institute.edu" /></Field>
            <Field label="Password" htmlFor="password"><Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" /></Field>
            {error && <p role="alert" className="text-sm text-critical">{error}</p>}
            <Button type="submit" variant="ink" size="lg" className="w-full" loading={busy || status === "loading"} iconRight={<ArrowRight size={16} />}>Sign in</Button>
          </form>
          {googleEnabled && (
            <>
              <div className="my-5 flex items-center gap-3 text-xs text-graphite-light"><span className="h-px flex-1 bg-rule/15" />or<span className="h-px flex-1 bg-rule/15" /></div>
              <Button variant="outline" size="lg" className="w-full" onClick={() => signInWithGoogle()}>Continue with Google</Button>
            </>
          )}

          <div className="mt-10 rounded-lg bg-sheet p-4 shadow-sheet hairline">
            <div className="flex items-center gap-2"><KeyRound size={14} className="text-pen" /><span className="readout">Demo institution — synthetic data</span></div>
            <p className="mt-1.5 text-xs text-graphite">Pick a desk to fill in the email. Use the demo password you were given.</p>
            <ul className="mt-3 grid grid-cols-2 gap-2">
              {DEMO.map((d) => (
                <li key={d.role}>
                  <button type="button" onClick={() => { setEmail(d.email); document.getElementById("password")?.focus(); }}
                    className="w-full rounded-md bg-paper-deep/50 px-3 py-2 text-left hairline transition-colors hover:bg-pen-wash">
                    <span className="block text-sm font-medium">{d.role}</span>
                    <span className="block truncate text-[11px] text-graphite">{d.who}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
