/** MentorOS "field instrument" design tokens → Tailwind.
 *  Every colour is a CSS variable (RGB channels) so both themes — Paper
 *  (default) and Night Shift — come from one definition in index.css. */
const c = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["selector", '[data-theme="night"]'],
  theme: {
    extend: {
      colors: {
        paper: { DEFAULT: c("paper"), deep: c("paper-deep") },
        sheet: { DEFAULT: c("sheet"), raised: c("sheet-raised") },
        ink: { DEFAULT: c("ink"), soft: c("ink-soft") },
        graphite: { DEFAULT: c("graphite"), light: c("graphite-light") },
        rule: { DEFAULT: c("rule"), strong: c("rule-strong") },
        pen: { DEFAULT: c("pen"), deep: c("pen-deep"), wash: c("pen-wash") },
        thrive: { DEFAULT: c("thrive"), wash: c("thrive-wash") },
        watch: { DEFAULT: c("watch"), wash: c("watch-wash") },
        critical: { DEFAULT: c("critical"), wash: c("critical-wash") },
        void: { DEFAULT: c("void"), wash: c("void-wash") },
      },
      fontFamily: {
        display: ["Fraunces", "ui-serif", "Georgia", "serif"],
        sans: ["'Hanken Grotesk'", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["'Martian Mono'", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
        display: ["clamp(2.75rem, 1.6rem + 4.6vw, 6.5rem)", { lineHeight: "0.92", letterSpacing: "-0.035em" }],
        hero: ["clamp(2rem, 1.4rem + 2.4vw, 3.5rem)", { lineHeight: "1", letterSpacing: "-0.03em" }],
        title: ["clamp(1.5rem, 1.25rem + 0.9vw, 2.125rem)", { lineHeight: "1.1", letterSpacing: "-0.02em" }],
      },
      borderRadius: { xs: "4px", sm: "8px", md: "12px", lg: "18px", xl: "26px" },
      boxShadow: {
        sheet: "0 1px 0 rgb(var(--shadow) / 0.06), 0 1px 2px rgb(var(--shadow) / 0.05), 0 8px 24px -12px rgb(var(--shadow) / 0.14)",
        stack: "0 1px 0 rgb(var(--shadow) / 0.06), 4px 4px 0 -1px rgb(var(--sheet)), 4px 4px 0 0 rgb(var(--rule-strong) / 0.9), 0 18px 40px -20px rgb(var(--shadow) / 0.35)",
        lift: "0 2px 0 rgb(var(--shadow) / 0.05), 0 24px 48px -22px rgb(var(--shadow) / 0.45)",
        pen: "0 0 0 3px rgb(var(--pen) / 0.18)",
        inset: "inset 0 1px 2px rgb(var(--shadow) / 0.08)",
      },
      transitionTimingFunction: {
        out: "cubic-bezier(0.16, 1, 0.3, 1)",
        io: "cubic-bezier(0.65, 0, 0.35, 1)",
        in: "cubic-bezier(0.7, 0, 0.84, 0)",
      },
      transitionDuration: { fast: "250ms", base: "600ms", slow: "1100ms" },
      keyframes: {
        nib: { "0%,100%": { transform: "scale(1)" }, "50%": { transform: "scale(1.35)" } },
        shimmer: { "100%": { transform: "translateX(100%)" } },
        "pulse-ring": { "0%": { transform: "scale(.8)", opacity: ".7" }, "100%": { transform: "scale(2.4)", opacity: "0" } },
      },
      animation: {
        nib: "nib 1.6s cubic-bezier(0.65,0,0.35,1) infinite",
        shimmer: "shimmer 1.6s cubic-bezier(0.65,0,0.35,1) infinite",
        "pulse-ring": "pulse-ring 1.8s cubic-bezier(0.16,1,0.3,1) infinite",
      },
    },
  },
  plugins: [],
};
