import { useMemo } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, Check } from "lucide-react";
import { useAuth, homeFor } from "@/lib/auth";
import { BAND } from "@/lib/format";
import { Button, EASE } from "@/ui/core";
import { Wordmark } from "@/app/Shell";

function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

/** A cohort of traces across 18 weeks. Trace #0 is the one that wavers. */
function useTraces(width: number, height: number) {
  return useMemo(() => {
    const weeks = 48;
    const traces = Array.from({ length: 7 }, (_, t) => {
      const r = rng(31 + t * 7);
      const base = t === 0 ? 76 : 73 + r() * 20;
      const pts: [number, number][] = [];
      for (let i = 0; i <= weeks; i++) {
        let v = base + Math.sin(i / (3 + r() * 2) + t) * 2.4 + (r() - 0.5) * 3.2;
        if (t === 0) {
          const dip = Math.exp(-((i - 27) ** 2) / 40) * 31;
          const recover = i > 33 ? Math.min(1, (i - 33) / 9) * 6 : 0;
          v = base - dip + recover + (r() - 0.5) * 3.5;
        }
        pts.push([(i / weeks) * width, height - ((v - 30) / 70) * height]);
      }
      const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
      return { d, pts };
    });
    return traces;
  }, [width, height]);
}

function HeroInstrument() {
  const reduce = useReducedMotion();
  const W = 1600, H = 420;
  const traces = useTraces(W, H);
  const y = (v: number) => H - ((v - 30) / 70) * H;
  const lowest = traces[0].pts.reduce((a, b) => (b[1] > a[1] ? b : a));
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H + 40}`} preserveAspectRatio="none" className="h-[300px] w-full sm:h-[400px]" role="img" aria-label="A cohort of student signals; one dips into the critical band, a mentor intervenes and it recovers.">
        <rect x={0} y={y(100)} width={W} height={y(70) - y(100)} fill={BAND.green.wash} opacity={0.45} />
        <rect x={0} y={y(70)} width={W} height={y(50) - y(70)} fill={BAND.amber.wash} opacity={0.45} />
        <rect x={0} y={y(50)} width={W} height={y(30) - y(50)} fill={BAND.coral.wash} opacity={0.45} />
        {[50, 70].map((v) => <line key={v} x1={0} x2={W} y1={y(v)} y2={y(v)} stroke="rgb(var(--rule))" strokeOpacity={0.25} strokeDasharray="4 6" />)}
        {traces.slice(1).map((t, i) => (
          <motion.path key={i} d={t.d} fill="none" stroke="rgb(var(--ink))" strokeOpacity={0.16} strokeWidth={1.4} vectorEffect="non-scaling-stroke"
            initial={{ pathLength: reduce ? 1 : 0 }} animate={{ pathLength: 1 }} transition={{ duration: 2.6, delay: 0.2 + i * 0.08, ease: [0.65, 0, 0.35, 1] }} />
        ))}
        <motion.path d={traces[0].d} fill="none" stroke="rgb(var(--ink))" strokeWidth={2.6} vectorEffect="non-scaling-stroke" strokeLinecap="round"
          initial={{ pathLength: reduce ? 1 : 0 }} animate={{ pathLength: 1 }} transition={{ duration: 3, delay: 0.3, ease: [0.65, 0, 0.35, 1] }} />
        {/* the catch: pen ellipse around the dip */}
        <motion.ellipse cx={lowest[0]} cy={lowest[1]} rx={78} ry={44} fill="none" stroke="rgb(var(--pen))" strokeWidth={2.2} vectorEffect="non-scaling-stroke"
          initial={{ pathLength: reduce ? 1 : 0, opacity: reduce ? 1 : 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 0.9, delay: 2.3, ease: EASE }} />
      </svg>
      <motion.div className="absolute hidden sm:block" style={{ left: `calc(${(lowest[0] / W) * 100}% + 70px)`, top: `${(lowest[1] / (H + 40)) * 100}%` }}
        initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 2.9, duration: 0.8, ease: EASE }}>
        <div className="-translate-y-1/2 rotate-[-1.5deg] rounded-md bg-sheet px-3 py-2 shadow-stack hairline">
          <div className="readout !text-pen">Week 11 · flagged</div>
          <div className="mt-0.5 font-display text-[15px] italic">“Attendance slipping, two internals under 40%. Met Tuesday — plan agreed.”</div>
          <div className="mt-1 text-[11px] text-graphite">— Dr. Meera Iyer, mentor</div>
        </div>
      </motion.div>
      <div className="pointer-events-none absolute right-4 top-3 hidden flex-col items-end gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-graphite sm:flex">
        <span style={{ color: BAND.green.ink }}>● Thriving ≥ 70</span>
        <span style={{ color: BAND.amber.ink }}>● Watch 50–69</span>
        <span style={{ color: BAND.coral.ink }}>● Critical &lt; 50</span>
      </div>
    </div>
  );
}

const PILLARS = [
  { w: 35, name: "Attendance", line: "Classes attended out of classes held, across every subject — straight from the register." },
  { w: 35, name: "Academic", line: "Your latest SGPA on the 10-point scale. Weak internals raise an alert before results do." },
  { w: 15, name: "Engagement", line: "LMS logins measured against your own department, plus the assignments you actually submit." },
  { w: 15, name: "Placement", line: "Resume, skills and certifications — the part of the score a student can move this week." },
];

const DESKS = [
  { role: "Student", line: "See your own trace, what’s pulling it down, and exactly how many classes you can or can’t miss.", to: "student" },
  { role: "Mentor", line: "A morning queue of who needs you, a brief before every meeting, and notes that turn into action items.", to: "mentor" },
  { role: "Head of Department", line: "The whole cohort as strata over time, mentor workload, hardest subjects, and one-click allocation.", to: "hod" },
  { role: "Administrator", line: "People, imports from ERP/LMS, accreditation-ready exports and an audit log for every sensitive view.", to: "admin" },
];

export default function Landing() {
  const { me } = useAuth();
  const cta = me ? homeFor(me.role) : "/login";
  return (
    <div className="min-h-[100dvh] overflow-x-hidden">
      <header className="mx-auto flex max-w-[1440px] items-center justify-between px-5 py-5 sm:px-10">
        <Wordmark />
        <nav className="flex items-center gap-2 text-sm">
          <a href="#score" className="link-draw hidden px-2 py-1 text-ink-soft sm:inline">How the score works</a>
          <a href="#desks" className="link-draw hidden px-2 py-1 text-ink-soft sm:inline">Who it’s for</a>
          <Link to={cta}><Button variant="ink" size="sm" iconRight={<ArrowRight size={14} />}>{me ? "Open MentorOS" : "Sign in"}</Button></Link>
        </nav>
      </header>

      <section className="relative">
        <div className="mx-auto max-w-[1440px] px-5 pt-10 sm:px-10 sm:pt-16">
          <motion.div className="readout" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }}>Early-warning mentoring for engineering institutes</motion.div>
          <h1 className="mt-5 font-display text-display">
            {["Every student leaves a trace.", "Notice when it wavers."].map((l, i) => (
              <span key={l} className="block overflow-hidden pb-[0.06em]">
                <motion.span className={i === 1 ? "block italic text-pen" : "block"} initial={{ y: "108%" }} animate={{ y: 0 }} transition={{ duration: 1.2, delay: 0.1 + i * 0.12, ease: EASE }}>{l}</motion.span>
              </span>
            ))}
          </h1>
          <motion.div className="mt-7 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5, duration: 0.9, ease: EASE }}>
            <p className="max-w-xl text-[17px] leading-relaxed text-ink-soft">
              MentorOS reads attendance, results, LMS activity and placement readiness as one explainable signal — so a mentor meets the student in week six, not after the exam form is rejected.
            </p>
            <div className="flex gap-2">
              <Link to={cta}><Button variant="ink" size="lg" iconRight={<ArrowRight size={16} />}>{me ? "Open your desk" : "Sign in"}</Button></Link>
              <a href="#score"><Button variant="outline" size="lg">See the formula</Button></a>
            </div>
          </motion.div>
        </div>
        <div className="mt-10 border-y border-rule/10 bg-sheet/50 graph"><HeroInstrument /></div>
      </section>

      <section id="score" className="mx-auto max-w-[1440px] px-5 py-20 sm:px-10 sm:py-28">
        <div className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <div className="readout">The Student Success Score</div>
            <h2 className="mt-3 font-display text-[clamp(2rem,1.4rem+2vw,3.4rem)] leading-[0.98] tracking-[-0.035em]">One number.<br />Four honest parts.</h2>
            <p className="mt-4 max-w-sm text-graphite">Agreed with faculty, identical on every screen. If attendance or results haven’t arrived yet, MentorOS says <em>awaiting data</em> instead of guessing.</p>
          </div>
          <ol className="lg:col-span-8">
            {PILLARS.map((p, i) => (
              <motion.li key={p.name} className="group grid grid-cols-[72px_1fr] items-baseline gap-4 border-t border-rule/15 py-6 sm:grid-cols-[120px_200px_1fr]"
                initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-60px" }} transition={{ duration: 0.8, delay: i * 0.06, ease: EASE }}>
                <span className="font-display text-[3.2rem] leading-none tracking-[-0.05em] transition-colors duration-fast group-hover:text-pen">{p.w}<span className="text-xl">%</span></span>
                <span className="font-display text-2xl">{p.name}</span>
                <span className="col-span-2 text-graphite sm:col-span-1">{p.line}</span>
              </motion.li>
            ))}
          </ol>
        </div>
      </section>

      <section id="desks" className="bg-ink text-paper">
        <div className="mx-auto max-w-[1440px] px-5 py-20 sm:px-10 sm:py-28">
          <div className="readout !text-paper/50">Four desks · one signal</div>
          <h2 className="mt-3 max-w-3xl font-display text-[clamp(2rem,1.4rem+2vw,3.4rem)] leading-[0.98] tracking-[-0.035em]">Everyone looks at the same trace — from where they sit.</h2>
          <ul className="mt-12">
            {DESKS.map((d, i) => (
              <motion.li key={d.role} initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: i * 0.08, duration: 0.8 }}
                className="group grid gap-2 border-t border-paper/15 py-7 sm:grid-cols-[1fr_1.4fr] sm:items-baseline">
                <span className="font-display text-[clamp(1.8rem,1.2rem+2vw,3rem)] tracking-[-0.03em] transition-transform duration-base ease-out group-hover:translate-x-2">{d.role}</span>
                <span className="text-paper/70">{d.line}</span>
              </motion.li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mx-auto max-w-[1440px] px-5 py-20 sm:px-10 sm:py-28">
        <div className="grid gap-12 lg:grid-cols-3">
          {[
            ["Consent you can see", "Students decide what goes into accreditation exports and the placement cell, under India’s DPDP Act. Under-18s are protected by default."],
            ["Data that knows its origin", "Every row is tagged with its source batch. The demo institution here is synthetic and can be purged in one step before real records arrive."],
            ["Plugs into what you run", "CSV today; ERP, LMS, attendance and placement connectors through one pipeline. Optional LLM, email and webhook integrations never block the core."],
          ].map(([t, b]) => (
            <div key={t} className="border-t-2 border-ink pt-5">
              <div className="flex items-center gap-2 font-display text-2xl"><Check size={18} className="text-pen" />{t}</div>
              <p className="mt-3 text-graphite">{b}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-rule/10">
        <div className="mx-auto max-w-[1440px] px-5 py-16 sm:px-10">
          <p className="font-display text-[clamp(2.4rem,1rem+6vw,7rem)] leading-[0.9] tracking-[-0.045em]">Catch it in week six,<br /><span className="italic text-pen">not week sixteen.</span></p>
          <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <Link to={cta}><Button variant="ink" size="lg" iconRight={<ArrowRight size={16} />}>{me ? "Back to your desk" : "Sign in to MentorOS"}</Button></Link>
            <span className="readout">MentorOS · demo data is synthetic · {new Date().getFullYear()}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
