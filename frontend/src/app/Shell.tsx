import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { Command } from "cmdk";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, LogOut, Moon, Search, Sparkles, Sun } from "lucide-react";
import { api, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { BAND, cn, relative } from "@/lib/format";
import type { NotificationItem, Paged, StudentRow } from "@/lib/types";
import { Avatar, EASE, Kbd, TraceGlyph } from "@/ui/core";
import { DropMenu, Popover } from "@/ui/overlay";
import { CompanionPanel } from "@/features/companion/CompanionPanel";
import { NAV, ROLE_LABEL } from "./nav";
import { useTheme } from "./theme";

export function Wordmark({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-ink text-paper">
        <TraceGlyph className="h-[18px] w-[18px]" />
      </span>
      {!compact && <span className="font-display text-[1.28rem] tracking-[-0.03em]">Mentor<span className="italic text-pen">OS</span></span>}
    </span>
  );
}

function Notifications() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data } = useQuery({ queryKey: ["notifications"], queryFn: () => api.get<{ unread: number; items: NotificationItem[] }>("/notifications"), refetchInterval: 60_000 });
  const open = async (n: NotificationItem) => {
    if (!n.read) await api.post(`/notifications/${n.id}/read`);
    qc.invalidateQueries({ queryKey: ["notifications"] });
    if (n.link) navigate(n.link.split("?")[0]);
  };
  return (
    <Popover
      className="w-[360px] max-w-[calc(100vw-24px)]"
      trigger={
        <button aria-label="Notifications" className="relative grid h-9 w-9 place-items-center rounded-md text-ink-soft hover:bg-ink/[0.05] hover:text-ink">
          <Bell size={18} />
          {!!data?.unread && (
            <span className="absolute right-1.5 top-1.5 flex h-2.5 w-2.5">
              <span className="absolute inset-0 animate-pulse-ring rounded-full bg-critical" />
              <span className="relative h-2.5 w-2.5 rounded-full bg-critical ring-2 ring-paper" />
            </span>
          )}
        </button>
      }
    >
      <div className="flex items-center justify-between border-b border-rule/10 px-4 py-3">
        <span className="font-display text-lg">Notifications</span>
        {!!data?.unread && (
          <button className="text-xs text-pen hover:underline" onClick={async () => { await api.post("/notifications/read-all"); qc.invalidateQueries({ queryKey: ["notifications"] }); }}>
            Mark all read
          </button>
        )}
      </div>
      <ul className="max-h-[420px] overflow-y-auto py-1">
        {!data?.items.length && <li className="px-4 py-8 text-center text-sm text-graphite">You're all caught up.</li>}
        {data?.items.map((n) => (
          <li key={n.id}>
            <button onClick={() => open(n)} className="flex w-full gap-3 px-4 py-3 text-left hover:bg-ink/[0.03]">
              <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.read ? "bg-transparent" : n.kind === "risk_alert" ? "bg-critical" : "bg-pen")} />
              <span className="min-w-0">
                <span className={cn("block text-sm", !n.read && "font-semibold")}>{n.title}</span>
                {n.body && <span className="block truncate text-xs text-graphite">{n.body}</span>}
                <span className="readout mt-1 block !text-[9px]">{relative(n.created_at)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Popover>
  );
}

function CommandPalette({ open, setOpen, onAsk }: { open: boolean; setOpen: (v: boolean) => void; onAsk: (q: string) => void }) {
  const { me } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const staff = me && me.role !== "student";
  const base = me ? `/${me.role}` : "";
  const { data } = useQuery({
    queryKey: ["palette", q],
    queryFn: () => api.get<Paged<StudentRow>>(`/students${qs({ q, page_size: 8, sort: "name" })}`),
    enabled: open && !!staff && q.length >= 2,
  });
  useEffect(() => { if (!open) setQ(""); }, [open]);
  if (!me) return null;
  const go = (to: string) => { setOpen(false); navigate(to); };
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[80] flex items-start justify-center bg-ink/25 px-3 pt-[12vh] backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)}>
          <motion.div onClick={(e) => e.stopPropagation()} initial={{ y: 16, scale: 0.98, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 1 }} exit={{ y: 8, opacity: 0 }} transition={{ duration: 0.4, ease: EASE }}
            className="w-full max-w-xl overflow-hidden rounded-xl bg-sheet shadow-lift hairline">
            <Command shouldFilter={!staff || q.length < 2} label="Command palette" loop>
              <div className="flex items-center gap-3 border-b border-rule/10 px-4">
                <Search size={16} className="text-graphite" />
                <Command.Input autoFocus value={q} onValueChange={setQ} placeholder={staff ? "Search students, pages — or ask the companion…" : "Jump to a page or ask the companion…"}
                  className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-graphite-light" />
                <Kbd>esc</Kbd>
              </div>
              <Command.List className="max-h-[50vh] overflow-y-auto p-2 [&_[cmdk-group-heading]]:readout [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-2">
                <Command.Empty className="px-3 py-6 text-center text-sm text-graphite">No matches.</Command.Empty>
                {q.length > 2 && (
                  <Command.Group heading="Companion">
                    <Command.Item value={`ask ${q}`} onSelect={() => { setOpen(false); onAsk(q); }} className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-sm aria-selected:bg-pen-wash aria-selected:text-pen-deep">
                      <Sparkles size={16} /> Ask: <span className="truncate font-medium">“{q}”</span>
                    </Command.Item>
                  </Command.Group>
                )}
                {!!data?.items.length && (
                  <Command.Group heading="Students">
                    {data.items.map((s) => (
                      <Command.Item key={s.id} value={`${s.name} ${s.usn}`} onSelect={() => go(`${base}/students/${s.id}`)} className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm aria-selected:bg-ink/[0.05]">
                        <Avatar name={s.name} src={s.avatar_url} size={26} ring={s.band} />
                        <span className="flex-1 truncate">{s.name} <span className="text-graphite-light">· {s.usn}</span></span>
                        <span className="tnum text-xs" style={{ color: BAND[s.band].ink }}>{s.score?.toFixed(1) ?? "—"}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
                <Command.Group heading="Go to">
                  {NAV[me.role].map((n) => (
                    <Command.Item key={n.to} value={n.label} onSelect={() => go(n.to)} className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm aria-selected:bg-ink/[0.05]">
                      <n.icon size={16} className="text-graphite" /> {n.label}
                    </Command.Item>
                  ))}
                </Command.Group>
              </Command.List>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Shell() {
  const { me, signOut } = useAuth();
  const [theme, toggleTheme] = useTheme();
  const [palette, setPalette] = useState(false);
  const [companion, setCompanion] = useState(false);
  const [seed, setSeed] = useState<string | null>(null);
  const location = useLocation();
  const nav = useMemo(() => (me ? NAV[me.role] : []), [me]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((v) => !v); }
      if ((e.metaKey || e.ctrlKey) && e.key === "j") { e.preventDefault(); setCompanion((v) => !v); }
      if (e.key === "Escape") setPalette(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [location.pathname]);
  useEffect(() => {
    const onAsk = (e: Event) => { setSeed((e as CustomEvent<string>).detail); setCompanion(true); };
    window.addEventListener("mentoros:ask", onAsk);
    return () => window.removeEventListener("mentoros:ask", onAsk);
  }, []);
  if (!me) return null;
  const ask = (q: string) => { setSeed(q); setCompanion(true); };

  return (
    <div className="min-h-[100dvh] lg:pl-[248px]">
      {/* Spine / rail */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] flex-col border-r border-rule/10 bg-paper-deep/50 px-4 pb-4 pt-5 backdrop-blur lg:flex">
        <NavLink to={nav[0].to} className="px-2"><Wordmark /></NavLink>
        <div className="mt-6 rounded-lg bg-sheet/70 px-3 py-2.5 hairline">
          <div className="readout">{ROLE_LABEL[me.role]}</div>
          <div className="mt-0.5 truncate text-sm font-medium">{me.department?.name ?? "All departments"}</div>
        </div>
        <nav className="mt-5 flex-1 space-y-0.5" aria-label="Main">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => cn("group relative flex items-center gap-3 rounded-md px-3 py-2 text-[14px] transition-colors duration-fast", isActive ? "text-ink" : "text-graphite hover:text-ink")}>
              {({ isActive }) => (
                <>
                  {isActive && <motion.span layoutId="rail-active" className="absolute inset-0 -z-10 rounded-md bg-sheet shadow-sheet hairline" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
                  {isActive && <motion.span layoutId="rail-tick" className="absolute -left-4 top-2 h-5 w-[3px] rounded-r-full bg-pen" />}
                  <n.icon size={17} strokeWidth={isActive ? 2.1 : 1.7} />
                  {n.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <button onClick={() => setCompanion(true)} className="group mb-3 flex items-center gap-3 rounded-lg bg-ink px-3.5 py-3 text-left text-paper shadow-lift transition-transform duration-fast hover:-translate-y-0.5">
          <Sparkles size={17} className="text-pen-wash" />
          <span className="flex-1"><span className="block text-sm font-medium">Companion</span><span className="block text-[11px] text-paper/60">Ask about your data</span></span>
          <Kbd>⌘J</Kbd>
        </button>
        {me.is_synthetic && <p className="px-2 text-[11px] leading-snug text-graphite">Demo institution · synthetic data</p>}
      </aside>

      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-rule/10 bg-paper/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-2 px-4 sm:px-6 lg:px-10">
          <NavLink to={nav[0].to} className="lg:hidden"><Wordmark compact /></NavLink>
          <button onClick={() => setPalette(true)} className="ml-1 flex h-9 flex-1 items-center gap-2.5 rounded-md bg-sheet/80 px-3 text-sm text-graphite-light hairline hover:text-graphite sm:max-w-md">
            <Search size={15} /> <span className="truncate">{me.role === "student" ? "Jump to…" : "Search students or ask…"}</span>
            <span className="ml-auto hidden sm:inline-flex"><Kbd>⌘K</Kbd></span>
          </button>
          <div className="ml-auto flex items-center gap-1">
            <button aria-label="Open companion" onClick={() => setCompanion(true)} className="grid h-9 w-9 place-items-center rounded-md text-ink-soft hover:bg-ink/[0.05] lg:hidden"><Sparkles size={18} /></button>
            <button aria-label={theme === "night" ? "Switch to paper theme" : "Switch to night shift"} onClick={toggleTheme} className="grid h-9 w-9 place-items-center rounded-md text-ink-soft hover:bg-ink/[0.05] hover:text-ink">
              {theme === "night" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <Notifications />
            <DropMenu
              trigger={<button aria-label="Account" className="ml-1 rounded-full"><Avatar name={me.full_name} src={me.avatar_url} size={32} /></button>}
              items={[
                { label: <span className="flex flex-col"><span className="font-medium">{me.full_name}</span><span className="text-xs text-graphite">{me.email}</span></span>, onSelect: () => {} },
                "sep",
                { label: "Sign out", icon: <LogOut size={15} />, onSelect: () => signOut(), danger: true },
              ]}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-4 pb-28 pt-6 sm:px-6 sm:pt-8 lg:px-10 lg:pb-16">
        <AnimatePresence mode="wait">
          <motion.div key={location.pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.35, ease: EASE }}>
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Mobile tab bar */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-rule/10 bg-paper/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden">
        <div className="mx-auto flex max-w-lg justify-around px-2">
          {nav.filter((n) => n.mobile).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cn("flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10.5px]", isActive ? "text-ink" : "text-graphite")}>
              {({ isActive }) => (<><n.icon size={19} strokeWidth={isActive ? 2.2 : 1.7} /><span className={cn(isActive && "font-semibold")}>{n.label}</span></>)}
            </NavLink>
          ))}
        </div>
      </nav>

      <CommandPalette open={palette} setOpen={setPalette} onAsk={ask} />
      <CompanionPanel open={companion} onOpenChange={setCompanion} seed={seed} clearSeed={() => setSeed(null)} />
    </div>
  );
}
