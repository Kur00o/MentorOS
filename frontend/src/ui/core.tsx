import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { animate, motion, useInView, useReducedMotion } from "motion/react";
import { Loader2 } from "lucide-react";
import { BAND, cn, initials, signed } from "@/lib/format";
import type { Band } from "@/lib/types";

export const EASE = [0.16, 1, 0.3, 1] as const;
export const EASE_IO = [0.65, 0, 0.35, 1] as const;

/* ── Button ─────────────────────────────────────────────────────────────── */
type Variant = "ink" | "pen" | "outline" | "ghost" | "danger" | "soft";
type Size = "xs" | "sm" | "md" | "lg";
const variants: Record<Variant, string> = {
  ink: "bg-ink text-paper hover:bg-ink-soft shadow-[0_1px_0_rgb(255_255_255/0.12)_inset,0_6px_14px_-8px_rgb(var(--shadow)/0.6)]",
  pen: "bg-pen text-white hover:bg-pen-deep shadow-[0_1px_0_rgb(255_255_255/0.18)_inset,0_8px_18px_-10px_rgb(var(--pen)/0.9)]",
  outline: "bg-sheet text-ink hairline hover:bg-sheet-raised hover:shadow-sheet",
  ghost: "text-ink-soft hover:bg-ink/[0.05] hover:text-ink",
  soft: "bg-pen-wash text-pen-deep hover:bg-pen-wash/70",
  danger: "bg-critical text-white hover:brightness-110",
};
const sizes: Record<Size, string> = {
  xs: "h-7 px-2.5 text-xs gap-1.5 rounded-sm",
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-sm",
  md: "h-10 px-4 text-sm gap-2 rounded-md",
  lg: "h-12 px-6 text-[15px] gap-2.5 rounded-md",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "outline", size = "md", loading, icon, iconRight, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "group/btn relative inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-[background,box-shadow,transform,color] duration-fast ease-out active:translate-y-px disabled:pointer-events-none disabled:opacity-45",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children && <span>{children}</span>}
      {iconRight && <span className="transition-transform duration-fast ease-out group-hover/btn:translate-x-0.5">{iconRight}</span>}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonProps & { label: string }>(function IconButton({ label, className, size = "sm", ...rest }, ref) {
  return <Button ref={ref} aria-label={label} title={label} variant="ghost" size={size} className={cn("aspect-square !px-0", className)} {...rest} />;
});

/* ── Sheet (card) ───────────────────────────────────────────────────────── */
interface SheetProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  label?: ReactNode;
  title?: ReactNode;
  action?: ReactNode;
  tone?: "plain" | "stack" | "ruled" | "ink" | "inset";
  pad?: boolean;
}
export function Sheet({ label, title, action, tone = "plain", pad = true, className, children, ...rest }: SheetProps) {
  const tones = {
    plain: "bg-sheet shadow-sheet hairline",
    stack: "bg-sheet shadow-stack hairline",
    ruled: "bg-sheet shadow-sheet hairline ruled",
    ink: "bg-ink text-paper shadow-lift",
    inset: "bg-paper-deep/60 hairline",
  } as const;
  return (
    <section className={cn("relative rounded-lg", tones[tone], className)} {...rest}>
      {(label || title || action) && (
        <header className={cn("flex items-start justify-between gap-3", pad ? "px-5 pt-4 sm:px-6 sm:pt-5" : "px-5 pt-4")}>
          <div className="min-w-0">
            {label && <div className={cn("readout", tone === "ink" && "text-paper/60")}>{label}</div>}
            {title && <h2 className="mt-1 font-display text-[1.3rem] leading-tight tracking-[-0.015em]">{title}</h2>}
          </div>
          {action && <div className="flex shrink-0 items-center gap-1.5">{action}</div>}
        </header>
      )}
      <div className={cn(pad && "px-5 pb-5 pt-4 sm:px-6 sm:pb-6")}>{children}</div>
    </section>
  );
}

/* ── Band chip (highlighter) ────────────────────────────────────────────── */
export function BandChip({ band, score, size = "md", className, showLabel = true }: { band: Band; score?: number | null; size?: "sm" | "md"; className?: string; showLabel?: boolean }) {
  const b = BAND[band];
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-medium", size === "sm" ? "h-5 px-2 text-[11px]" : "h-6 px-2.5 text-xs", className)}
      style={{ background: b.wash, color: b.ink }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: b.ink }} />
      {score != null && <span className="tnum font-semibold">{score.toFixed(1)}</span>}
      {showLabel && <span>{b.label}</span>}
    </span>
  );
}

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "pen" | "thrive" | "watch" | "critical" | "ink"; className?: string }) {
  const t = {
    neutral: "bg-ink/[0.06] text-ink-soft",
    pen: "bg-pen-wash text-pen-deep",
    thrive: "bg-thrive-wash text-thrive",
    watch: "bg-watch-wash text-watch",
    critical: "bg-critical-wash text-critical",
    ink: "bg-ink text-paper",
  }[tone];
  return <span className={cn("inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11px] font-medium", t, className)}>{children}</span>;
}

export function Delta({ value, className, unit = "" }: { value: number | null | undefined; className?: string; unit?: string }) {
  if (value == null) return <span className={cn("text-graphite-light", className)}>—</span>;
  const tone = value > 0.05 ? "text-thrive" : value < -0.05 ? "text-critical" : "text-graphite";
  return (
    <span className={cn("tnum inline-flex items-center gap-0.5 font-medium", tone, className)}>
      <svg width="9" height="9" viewBox="0 0 10 10" className={cn(value < 0 && "rotate-180", Math.abs(value) <= 0.05 && "rotate-90")} aria-hidden>
        <path d="M5 1 L9 7 H1 Z" fill="currentColor" />
      </svg>
      {signed(value)}
      {unit}
    </span>
  );
}

/* ── Count-up number ────────────────────────────────────────────────────── */
export function CountUp({ value, digits = 0, className, suffix = "", duration = 1.1 }: { value: number | null | undefined; digits?: number; className?: string; suffix?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (value == null || !inView) return;
    if (reduce) {
      setShown(value);
      return;
    }
    const controls = animate(0, value, { duration, ease: EASE, onUpdate: setShown });
    return () => controls.stop();
  }, [value, inView, reduce, duration]);
  return (
    <span ref={ref} className={cn("tnum", className)}>
      {value == null ? "—" : shown.toFixed(digits)}
      {value != null && suffix}
    </span>
  );
}

/* ── Readout (KPI) ──────────────────────────────────────────────────────── */
export function Readout({ label, value, digits = 0, suffix, hint, delta, tone, className, onClick }: {
  label: string; value: number | null | undefined; digits?: number; suffix?: string; hint?: ReactNode; delta?: number | null; tone?: Band | "pen"; className?: string; onClick?: () => void;
}) {
  const color = tone === "pen" ? "rgb(var(--pen))" : tone ? BAND[tone].ink : undefined;
  const Comp = onClick ? "button" : "div";
  return (
    <Comp onClick={onClick} className={cn("group relative flex flex-col justify-between rounded-lg bg-sheet p-4 text-left shadow-sheet hairline transition-shadow duration-fast sm:p-5", onClick && "hover:shadow-lift", className)}>
      <div className="readout flex items-center gap-2">
        {color && <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />}
        {label}
      </div>
      <div className="mt-3 flex items-end justify-between gap-2">
        <CountUp value={value} digits={digits} suffix={suffix} className="font-display text-[2.4rem] leading-none tracking-[-0.04em]" />
        {delta !== undefined && <Delta value={delta} className="mb-1 text-xs" />}
      </div>
      {hint && <div className="mt-2 text-xs text-graphite">{hint}</div>}
    </Comp>
  );
}

/* ── Meter (horizontal) ─────────────────────────────────────────────────── */
export function Meter({ value, max = 100, color = "rgb(var(--ink))", threshold, className, height = 6 }: { value: number | null | undefined; max?: number; color?: string; threshold?: number; className?: string; height?: number }) {
  const w = value == null ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={cn("relative w-full overflow-hidden rounded-full bg-ink/[0.07]", className)} style={{ height }}>
      <motion.div className="absolute inset-y-0 left-0 rounded-full" style={{ background: color }} initial={{ width: 0 }} whileInView={{ width: `${w}%` }} viewport={{ once: true }} transition={{ duration: 1.1, ease: EASE }} />
      {threshold != null && <div className="absolute inset-y-[-2px] w-px bg-ink/60" style={{ left: `${(threshold / max) * 100}%` }} />}
    </div>
  );
}

/* ── Avatar ─────────────────────────────────────────────────────────────── */
const hues = [214, 154, 32, 8, 268, 190, 340, 96];
export function Avatar({ name, src, size = 32, className, ring }: { name: string; src?: string | null; size?: number; className?: string; ring?: Band }) {
  const hue = hues[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % hues.length];
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold", className)}
      style={{
        width: size, height: size, fontSize: size * 0.38,
        background: src ? undefined : `hsl(${hue} 45% 88%)`, color: `hsl(${hue} 45% 28%)`,
        boxShadow: ring ? `0 0 0 2px rgb(var(--sheet)), 0 0 0 3.5px ${BAND[ring].ink}` : undefined,
      }}
    >
      {src ? <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" /> : initials(name)}
    </span>
  );
}

/* ── Form controls ──────────────────────────────────────────────────────── */
const field = "w-full rounded-md bg-sheet-raised px-3 text-sm text-ink placeholder:text-graphite-light shadow-inset hairline transition-shadow duration-fast focus:outline-none focus:shadow-pen disabled:opacity-60";
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(field, "h-10", className)} {...rest} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(field, "min-h-[88px] py-2.5 leading-relaxed", className)} {...rest} />;
});
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cn(field, "h-10 cursor-pointer appearance-none bg-[length:14px] bg-[right_10px_center] bg-no-repeat pr-8", className)}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%2362605a'%3E%3Cpath d='M5.5 7.5 10 12l4.5-4.5'/%3E%3C/svg%3E\")" }} {...rest}>
      {children}
    </select>
  );
});
export function Field({ label, hint, error, children, className, htmlFor }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-ink-soft">{label}</label>
      {children}
      {error ? <p className="text-xs text-critical">{error}</p> : hint ? <p className="text-xs text-graphite">{hint}</p> : null}
    </div>
  );
}

export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={cn("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-fast disabled:opacity-50", checked ? "bg-pen" : "bg-ink/15")}>
      <motion.span layout transition={{ type: "spring", stiffness: 600, damping: 34 }} className={cn("h-5 w-5 rounded-full bg-white shadow", checked ? "ml-[22px]" : "ml-[2px]")} />
    </button>
  );
}

/* ── Segmented control ─────────────────────────────────────────────────── */
export function Segmented<T extends string>({ value, onChange, options, className, layoutId }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; count?: number }[]; className?: string; layoutId: string }) {
  return (
    <div role="tablist" className={cn("inline-flex rounded-md bg-ink/[0.05] p-0.5", className)}>
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}
          className={cn("relative z-0 inline-flex h-8 items-center gap-1.5 rounded-[9px] px-3 text-[13px] font-medium transition-colors duration-fast", value === o.value ? "text-ink" : "text-graphite hover:text-ink")}>
          {value === o.value && <motion.span layoutId={layoutId} className="absolute inset-0 -z-10 rounded-[9px] bg-sheet-raised shadow-sheet" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
          {o.label}
          {o.count != null && <span className="tnum text-[11px] text-graphite-light">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ── States ─────────────────────────────────────────────────────────────── */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-md bg-ink/[0.06]", className)}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-sheet/70 to-transparent" />
    </div>
  );
}

export function Empty({ title, body, action, icon }: { title: string; body?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-4 grid h-12 w-12 place-items-center rounded-full bg-ink/[0.05] text-graphite">{icon ?? <TraceGlyph />}</div>
      <p className="font-display text-lg">{title}</p>
      {body && <p className="mt-1 max-w-sm text-sm text-graphite">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorNote({ error, retry }: { error: unknown; retry?: () => void }) {
  const msg = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <div className="flex items-start gap-3 rounded-md bg-critical-wash/60 px-4 py-3 text-sm text-critical">
      <span className="mt-0.5">●</span>
      <div className="flex-1"><p className="font-medium">Couldn't load this</p><p className="text-critical/80">{msg}</p></div>
      {retry && <Button size="xs" variant="outline" onClick={retry}>Retry</Button>}
    </div>
  );
}

export function TraceGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 13h4l2-6 3 11 3-14 2.5 9H22" />
    </svg>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] bg-ink/[0.06] px-1 font-mono text-[10px] text-graphite hairline">{children}</kbd>;
}

/* ── Page header + reveal ───────────────────────────────────────────────── */
export function PageHeader({ eyebrow, title, sub, actions }: { eyebrow?: ReactNode; title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }} className="readout mb-2">{eyebrow}</motion.div>}
        <h1 className="overflow-hidden font-display text-hero">
          <motion.span className="block" initial={{ y: "105%" }} animate={{ y: 0 }} transition={{ duration: 1, ease: EASE }}>{title}</motion.span>
        </h1>
        {sub && <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.15, ease: EASE }} className="mt-2 max-w-2xl text-[15px] text-graphite">{sub}</motion.p>}
      </div>
      {actions && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2, duration: 0.6 }} className="flex flex-wrap items-center gap-2">{actions}</motion.div>}
    </div>
  );
}

export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div className={className} initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }} transition={{ duration: 0.8, delay, ease: EASE }}>
      {children}
    </motion.div>
  );
}

export function Stagger({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}>
      {children}
    </motion.div>
  );
}
export const staggerItem = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } } };
