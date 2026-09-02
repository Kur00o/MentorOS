import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Activity,
  ArrowRight,
  Brain,
  Briefcase,
  CalendarCheck,
  GraduationCap,
  LayoutDashboard,
  Lock,
  LogIn,
  Menu,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import type { ComponentKey } from "@/lib/score";
import type { Role, ScoreBreakdown as Breakdown } from "@/types";
import { COMPONENT_META, RISK_META, RISK_ORDER } from "@/lib/score";
import { Background } from "@/components/layout/Background";
import { Brand } from "@/components/Brand";
import { Button } from "@/components/primitives";
import { Reveal } from "@/components/Reveal";
import { SignalDisc } from "@/components/SignalDisc";
import { ScoreBreakdown } from "@/components/ScoreBreakdown";
import { useAppStore } from "@/store/useAppStore";

/** Illustrative high-performing student for the hero disc. */
const HERO_BREAKDOWN: Breakdown = {
  attendance_component: 88,
  academic_component: 84,
  engagement_component: 78,
  placement_component: 81,
  total_score: 84,
  risk_category: "green",
};

const COMPONENT_ICON: Record<ComponentKey, typeof Activity> = {
  attendance: CalendarCheck,
  academic: GraduationCap,
  engagement: Activity,
  placement: Briefcase,
};

const ROLES: Array<{ role: Role; to: string; title: string; blurb: string; icon: typeof Users }> = [
  {
    role: "student",
    to: "/demo/student",
    title: "Students",
    blurb: "See your own signal and exactly what moves it — with an AI companion to explain the rest.",
    icon: GraduationCap,
  },
  {
    role: "mentor",
    to: "/demo/mentor",
    title: "Mentors",
    blurb: "A roster sorted by who needs you. Schedule check-ins and log them as structured notes.",
    icon: Users,
  },
  {
    role: "hod",
    to: "/demo/hod",
    title: "HODs",
    blurb: "Department-wide risk, mentor workload and semester trends — the whole cohort at a glance.",
    icon: LayoutDashboard,
  },
  {
    role: "admin",
    to: "/demo/admin",
    title: "Admins",
    blurb: "Manage people, import attendance and marks, and export accreditation-ready reports.",
    icon: ShieldCheck,
  },
];

const NAV_LINKS = [
  { label: "How it works", href: "#how" },
  { label: "Risk states", href: "#states" },
  { label: "For your role", href: "#roles" },
];

export default function Landing() {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const { session } = useAppStore();

  function scrollTo(href: string) {
    setMenuOpen(false);
    document.querySelector(href)?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <div className="relative min-h-screen overflow-x-clip">
      <Background variant="landing" />

      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-white/40 bg-snow/70 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <button onClick={() => scrollTo("#top")} aria-label="MentorOS home" className="rounded-sm">
            <Brand />
          </button>
          <nav className="hidden items-center gap-8 md:flex" aria-label="Primary">
            {NAV_LINKS.map((l) => (
              <button
                key={l.href}
                onClick={() => scrollTo(l.href)}
                className="text-body text-ink-soft transition-colors hover:text-ink"
              >
                {l.label}
              </button>
            ))}
          </nav>
          <div className="hidden md:block">
            {session ? (
              <Button onClick={() => navigate("/app/mentor")} iconRight={<ArrowRight size={16} />}>
                Open App
              </Button>
            ) : (
              <Button onClick={() => navigate("/auth/login")} iconRight={<LogIn size={16} />}>
                Sign In
              </Button>
            )}
          </div>
          <button
            className="rounded-sm p-2 text-ink md:hidden"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Menu"
          >
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
        {menuOpen && (
          <div className="border-t border-white/40 bg-snow/95 px-4 py-3 md:hidden">
            {NAV_LINKS.map((l) => (
              <button
                key={l.href}
                onClick={() => scrollTo(l.href)}
                className="block w-full py-2 text-left text-body text-ink-soft"
              >
                {l.label}
              </button>
            ))}
            {session ? (
              <Button block className="mt-2" onClick={() => navigate("/app/mentor")}>
                Open App
              </Button>
            ) : (
              <Button block className="mt-2" onClick={() => navigate("/auth/login")}>
                Sign In
              </Button>
            )}
          </div>
        )}
      </header>

      <main id="top">
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-12 sm:px-6 lg:grid-cols-2 lg:gap-8 lg:pt-20">
          <div>
            <motion.span
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="inline-flex items-center gap-2 rounded-full border border-azure-200 bg-azure-200/40 px-3 py-1 text-caption font-medium text-azure-600"
            >
              <Brain size={14} /> The Student Success Score
            </motion.span>
            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.05 }}
              className="mt-5 font-display text-[40px] font-semibold leading-[1.05] tracking-tight text-ink sm:text-[52px] lg:text-display-xl"
            >
              Know which student needs you{" "}
              <span className="text-azure-500">today.</span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.12 }}
              className="mt-5 max-w-xl text-body text-ink-soft sm:text-[18px] sm:leading-7"
            >
              MentorOS blends attendance, marks, engagement and placement readiness into one
              transparent Success Score — so mentoring reaches whoever's slipping, not whoever
              shouts loudest. No more scattered spreadsheets.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.18 }}
              className="mt-7 flex flex-wrap items-center gap-3"
            >
              {session ? (
                <Button
                  size="lg"
                  onClick={() => navigate("/app/mentor")}
                  iconRight={<ArrowRight size={18} />}
                >
                  Open App Workspace
                </Button>
              ) : (
                <Button
                  size="lg"
                  onClick={() => navigate("/auth/login")}
                  iconRight={<LogIn size={18} />}
                >
                  Sign In / Get Started
                </Button>
              )}
              <Button size="lg" variant="secondary" onClick={() => scrollTo("#how")}>
                See how the score works
              </Button>
            </motion.div>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.28 }}
              className="mt-4 text-caption text-ink-soft"
            >
              No login needed — switch between Student, Mentor, HOD and Admin views inside.
            </motion.p>
          </div>

          {/* Hero disc */}
          <div className="flex justify-center lg:justify-end">
            <div className="flex flex-col items-center gap-4">
              <SignalDisc breakdown={HERO_BREAKDOWN} size="lg" animated />
              <p className="max-w-xs text-center text-caption text-ink-soft">
                A live four-axis read on{" "}
                <span className="font-medium text-ink">Attendance, Academic, Engagement</span> and{" "}
                <span className="font-medium text-ink">Placement</span> — one number, fully explainable.
              </p>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="scroll-mt-20 border-t border-white/50 bg-snow-deep/40 py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Reveal className="max-w-2xl">
              <h2 className="font-display text-heading font-semibold text-ink sm:text-display-lg">
                How the Success Score works
              </h2>
              <p className="mt-3 text-body text-ink-soft">
                No black box. Four components, each with a fixed weight, add up to a single 0–100
                score. Every part is visible to the student and the mentor.
              </p>
            </Reveal>

            <Reveal delay={0.05}>
              <div className="mt-8 flex flex-wrap items-center gap-x-2 gap-y-3 rounded-lg bg-white/60 p-5 font-mono text-caption text-ink-soft sm:text-body">
                <span className="font-semibold text-ink">Score</span>
                <span>=</span>
                {COMPONENT_META.map((m, i) => (
                  <span key={m.key} className="flex items-center gap-2">
                    {i > 0 && <span className="text-azure-500">+</span>}
                    <span className="rounded-full bg-azure-200/50 px-2.5 py-1 text-azure-600">
                      {Math.round(m.weight * 100)}% {m.label}
                    </span>
                  </span>
                ))}
              </div>
            </Reveal>

            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {COMPONENT_META.map((m, i) => {
                const Icon = COMPONENT_ICON[m.key];
                return (
                  <Reveal key={m.key} delay={0.05 * i}>
                    <div className="glass-quiet h-full p-5">
                      <div className="flex items-center justify-between">
                        <span className="flex h-10 w-10 items-center justify-center rounded-md bg-azure-200/60 text-azure-600">
                          <Icon size={20} />
                        </span>
                        <span className="font-mono tnum text-body font-semibold text-azure-600">
                          {Math.round(m.weight * 100)}%
                        </span>
                      </div>
                      <h3 className="mt-3 font-display text-body font-semibold text-ink">{m.label}</h3>
                      <p className="mt-1 text-caption text-ink-soft">{m.description}</p>
                    </div>
                  </Reveal>
                );
              })}
            </div>

            {/* Explainable, not a mystery */}
            <div className="mt-12 grid items-center gap-8 lg:grid-cols-2">
              <Reveal>
                <div>
                  <h3 className="font-display text-heading font-semibold text-ink">
                    Explainable, down to the last point
                  </h3>
                  <p className="mt-3 text-body text-ink-soft">
                    The same breakdown a student sees is the one a mentor acts on. No guessing why a
                    score moved — the bars show which signal slipped and by how much.
                  </p>
                  <ul className="mt-5 space-y-3">
                    {[
                      "Transparent weights — never a hidden model",
                      "Students control what each mentor can see",
                      "Backlogs, attendance and submissions, all traceable",
                    ].map((t) => (
                      <li key={t} className="flex items-start gap-2.5 text-body text-ink">
                        <ShieldCheck size={18} className="mt-0.5 shrink-0 text-signal-green" />
                        {t}
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
              <Reveal delay={0.08}>
                <div className="glass-quiet p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <span className="text-caption font-medium text-ink-soft">Sample breakdown</span>
                    <span className="font-mono tnum text-[22px] font-semibold text-ink">
                      {HERO_BREAKDOWN.total_score}
                    </span>
                  </div>
                  <ScoreBreakdown breakdown={HERO_BREAKDOWN} />
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* Risk states */}
        <section id="states" className="scroll-mt-20 py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Reveal className="max-w-2xl">
              <h2 className="font-display text-heading font-semibold text-ink sm:text-display-lg">
                Three states, one glance
              </h2>
              <p className="mt-3 text-body text-ink-soft">
                The score rolls up into a calm, considered signal — not a panic-inducing traffic
                light. You always know who's fine and who needs a conversation.
              </p>
            </Reveal>
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {RISK_ORDER.map((cat, i) => {
                const meta = RISK_META[cat];
                const range = cat === "green" ? "70 – 100" : cat === "amber" ? "50 – 69" : "0 – 49";
                return (
                  <Reveal key={cat} delay={0.06 * i}>
                    <div className="glass-quiet h-full p-6" style={{ borderTop: `3px solid ${meta.hex}` }}>
                      <div className="flex items-center justify-between">
                        <span
                          className="rounded-full px-2.5 py-0.5 text-caption font-medium"
                          style={{ background: `color-mix(in srgb, ${meta.hex} 14%, white)`, color: meta.hex }}
                        >
                          {meta.label}
                        </span>
                        <span className="font-mono tnum text-caption text-ink-soft">{range}</span>
                      </div>
                      <p className="mt-3 text-body text-ink-soft">{meta.blurb}</p>
                    </div>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </section>

        {/* Roles */}
        <section id="roles" className="scroll-mt-20 border-t border-white/50 bg-snow-deep/40 py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Reveal className="max-w-2xl">
              <h2 className="font-display text-heading font-semibold text-ink sm:text-display-lg">
                Built for everyone in the mentoring loop
              </h2>
              <p className="mt-3 text-body text-ink-soft">
                One signal, four vantage points. Jump straight into any dashboard — it's already
                populated with a full department of demo data.
              </p>
            </Reveal>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {ROLES.map((r, i) => {
                const Icon = r.icon;
                return (
                  <Reveal key={r.role} delay={0.05 * i}>
                    <Link
                      to={r.to}
                      className="glass-quiet group flex h-full items-start gap-4 p-6 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_16px_34px_-10px_rgba(17,32,59,0.16)]"
                    >
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-azure-500 text-white">
                        <Icon size={22} />
                      </span>
                      <div className="min-w-0">
                        <h3 className="flex items-center gap-1.5 font-display text-body font-semibold text-ink">
                          {r.title}
                          <ArrowRight
                            size={16}
                            className="text-azure-500 transition-transform group-hover:translate-x-1"
                          />
                        </h3>
                        <p className="mt-1 text-caption text-ink-soft">{r.blurb}</p>
                        <span className="mt-3 inline-block text-caption font-medium text-azure-600">
                          View dashboard
                        </span>
                      </div>
                    </Link>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </section>

        {/* Closing CTA */}
        <section className="py-20">
          <div className="mx-auto max-w-4xl px-4 sm:px-6">
            <Reveal>
              <div className="glass-strong flex flex-col items-center gap-5 px-6 py-12 text-center">
                <h2 className="max-w-2xl font-display text-heading font-semibold text-ink sm:text-display-lg">
                  See the whole department in one signal
                </h2>
                <p className="max-w-xl text-body text-ink-soft">
                  Everything runs on realistic demo data — no setup, no login. Step into the mentor
                  view and find the students who need you.
                </p>
                <div className="flex flex-wrap justify-center gap-3">
                  <Button size="lg" onClick={() => navigate("/demo/mentor")} iconRight={<ArrowRight size={18} />}>
                    Open the live demo
                  </Button>
                  <Button size="lg" variant="secondary" onClick={() => navigate("/demo/student")}>
                    Start as a student
                  </Button>
                </div>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/50 bg-snow/70 py-10 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div>
            <Brand size="sm" />
            <p className="mt-2 max-w-xs text-caption text-ink-soft">
              One clear, trustworthy signal per student — from attendance, marks and engagement.
            </p>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {ROLES.map((r) => (
              <Link key={r.role} to={r.to} className="text-caption text-ink-soft hover:text-ink">
                {r.title}
              </Link>
            ))}
          </div>
          <p className="flex items-center gap-1.5 text-caption text-ink-soft">
            <Lock size={13} /> Demo build · mock data only
          </p>
        </div>
      </footer>
    </div>
  );
}
