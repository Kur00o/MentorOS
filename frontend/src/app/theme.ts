import { useCallback, useEffect, useState } from "react";

export type Theme = "paper" | "night";

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme === "night" ? "night" : "paper"));
  useEffect(() => {
    if (theme === "night") document.documentElement.dataset.theme = "night";
    else delete document.documentElement.dataset.theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "night" ? "#0C0F15" : "#F2EEE5");
    try { localStorage.setItem("mentoros-theme", theme); } catch { /* storage unavailable */ }
  }, [theme]);
  const toggle = useCallback(() => {
    const apply = () => setTheme((t) => (t === "night" ? "paper" : "night"));
    const doc = document as Document & { startViewTransition?: (cb: () => void) => void };
    if (doc.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) doc.startViewTransition(apply);
    else apply();
  }, []);
  return [theme, toggle];
}
