import { useEffect, useRef, useState } from "react";
import * as D from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "motion/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowUp, BookOpen, Eraser, Sparkles, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { BAND, cn, dateTime } from "@/lib/format";
import type { Band, CompanionCard, CompanionMessage, StudentRow } from "@/lib/types";
import { Avatar, BandChip, Delta, EASE } from "@/ui/core";
import { BandStrata, BarList, PillarStack } from "@/ui/charts";

interface ChatReply {
  conversation_id: string;
  answer: string;
  intent: string;
  cards: CompanionCard[];
  suggestions: string[];
  sources: { title: string; source: string }[];
  provider: string;
}

function Card({ card }: { card: CompanionCard }) {
  const navigate = useNavigate();
  const { me } = useAuth();
  const base = me ? `/${me.role}` : "";
  switch (card.type) {
    case "score":
    case "student": {
      const band = card.band as Band;
      return (
        <div className="rounded-md bg-paper-deep/50 p-3 hairline">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-3xl leading-none tracking-[-0.04em]" style={{ color: BAND[band].ink }}>{(card.total ?? card.score) == null ? "—" : Number(card.total ?? card.score).toFixed(1)}</span>
              {card.delta != null && <Delta value={card.delta as number} className="text-xs" />}
            </div>
            <BandChip band={band} size="sm" />
          </div>
          {card.type === "student" && <button className="mt-1 text-sm font-medium hover:underline" onClick={() => navigate(`${base}/students/${card.id}`)}>{String(card.name)} · {String(card.usn)}</button>}
          <div className="mt-3"><PillarStack components={card.components as Record<string, number | null>} weights={(card.weights as Record<string, number>) ?? { attendance: 0.35, academic: 0.35, engagement: 0.15, placement: 0.15 }} /></div>
          {Boolean(card.simulated) && <div className="readout mt-2">Simulated · not saved</div>}
        </div>
      );
    }
    case "bars":
      return (
        <div className="rounded-md bg-paper-deep/50 p-3 hairline">
          <div className="readout mb-3">{String(card.title)}</div>
          <BarList rows={(card.rows as { label: string; value: number | null; hint?: string; max?: number }[]).slice(0, 8)} unit={String(card.unit ?? "%")} threshold={card.threshold as number | undefined} />
        </div>
      );
    case "students":
      return (
        <div className="overflow-hidden rounded-md hairline">
          {(card.rows as StudentRow[]).map((s) => (
            <button key={s.id} onClick={() => navigate(`${base}/students/${s.id}`)} className="flex w-full items-center gap-3 border-b border-rule/10 bg-paper-deep/30 px-3 py-2 text-left last:border-0 hover:bg-paper-deep/70">
              <Avatar name={s.name} size={26} ring={s.band} />
              <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{s.name}</span><span className="block text-[11px] text-graphite">{s.usn} · {s.open_alerts} alert{s.open_alerts === 1 ? "" : "s"}</span></span>
              <span className="tnum text-sm font-semibold" style={{ color: BAND[s.band].ink }}>{s.score?.toFixed(1) ?? "—"}</span>
            </button>
          ))}
        </div>
      );
    case "bands":
      return <div className="rounded-md bg-paper-deep/50 p-3 hairline"><BandStrata counts={card as unknown as Record<Band, number>} height={10} /></div>;
    case "meeting":
      return (
        <div className="flex items-center gap-3 rounded-md bg-pen-wash/60 p-3 text-pen-deep">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-sheet text-center leading-none">
            <span className="font-display text-lg">{new Date(String(card.scheduled_at)).getDate()}</span>
          </div>
          <div className="min-w-0"><div className="truncate text-sm font-semibold">{String(card.title)}</div><div className="text-xs">{dateTime(String(card.scheduled_at))}</div></div>
        </div>
      );
    case "actions":
      return (
        <ul className="space-y-1.5 rounded-md bg-paper-deep/50 p-3 hairline">
          {(card.items as { id: string; text: string; due: string | null }[]).map((a) => (
            <li key={a.id} className="flex items-start gap-2 text-[13px]"><span className="mt-1 h-3 w-3 shrink-0 rounded-[3px] border border-ink/40" />{a.text}</li>
          ))}
        </ul>
      );
    default:
      return null;
  }
}

function Writing() {
  return (
    <div className="flex items-center gap-2 text-graphite" aria-live="polite">
      <svg width="56" height="18" viewBox="0 0 56 18" aria-hidden>
        <motion.path d="M1 9 L10 9 L14 3 L19 15 L24 5 L28 12 L33 9 L55 9" fill="none" stroke="rgb(var(--pen))" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
          initial={{ pathLength: 0 }} animate={{ pathLength: [0, 1, 1] }} transition={{ duration: 1.4, repeat: Infinity, ease: [0.65, 0, 0.35, 1] }} />
      </svg>
      <span className="text-xs">Reading your records…</span>
    </div>
  );
}

export function CompanionPanel({ open, onOpenChange, seed, clearSeed }: { open: boolean; onOpenChange: (v: boolean) => void; seed: string | null; clearSeed: () => void }) {
  const { me } = useAuth();
  const [messages, setMessages] = useState<CompanionMessage[]>([]);
  const [conv, setConv] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const config = useQuery({ queryKey: ["companion-config"], queryFn: () => api.get<{ suggestions: string[]; llm: { status: string; message: string } }>("/companion/config"), enabled: open });
  const history = useQuery({
    queryKey: ["companion-history"],
    queryFn: () => api.get<{ conversation_id: string | null; messages: CompanionMessage[] }>("/companion/history?limit=30"),
    enabled: open && messages.length === 0,
    staleTime: Infinity,
  });
  useEffect(() => {
    if (history.data && messages.length === 0) {
      setMessages(history.data.messages);
      setConv(history.data.conversation_id);
    }
  }, [history.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useMutation({
    mutationFn: (message: string) => api.post<ChatReply>("/companion/chat", { message, conversation_id: conv ?? undefined }),
    onMutate: (message) => setMessages((m) => [...m, { role: "user", content: message, id: `u-${Date.now()}` }, { role: "assistant", content: "", pending: true, id: "pending" }]),
    onSuccess: (r) => {
      setConv(r.conversation_id);
      setMessages((m) => [...m.filter((x) => x.id !== "pending"), { role: "assistant", content: r.answer, cards: r.cards, suggestions: r.suggestions, sources: r.sources, provider: r.provider, id: `a-${Date.now()}` }]);
    },
    onError: (e) => setMessages((m) => [...m.filter((x) => x.id !== "pending"), { role: "assistant", content: `**I couldn't answer that.** ${e instanceof ApiError ? e.message : "Please try again."}`, id: `e-${Date.now()}` }]),
  });

  const submit = (text?: string) => {
    const q = (text ?? input).trim();
    if (!q || send.isPending) return;
    setInput("");
    send.mutate(q);
  };
  useEffect(() => { if (open && seed) { submit(seed); clearSeed(); } }, [open, seed]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [messages]);

  const reset = async () => { await api.del("/companion/history"); setMessages([]); setConv(null); };
  const lastSuggestions = [...messages].reverse().find((m) => m.role === "assistant" && m.suggestions?.length)?.suggestions ?? config.data?.suggestions ?? [];

  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <D.Portal forceMount>
            <D.Overlay asChild forceMount><motion.div className="fixed inset-0 z-50 bg-ink/20 lg:bg-transparent" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} /></D.Overlay>
            <D.Content asChild forceMount>
              <motion.aside className="fixed bottom-0 right-0 top-0 z-50 flex w-full max-w-[460px] flex-col border-l border-rule/10 bg-sheet shadow-lift focus:outline-none sm:bottom-3 sm:right-3 sm:top-3 sm:rounded-xl sm:hairline"
                initial={{ x: "105%" }} animate={{ x: 0 }} exit={{ x: "105%" }} transition={{ duration: 0.6, ease: EASE }}>
                <div className="flex items-center gap-3 border-b border-rule/10 px-5 py-4">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-ink text-paper"><Sparkles size={16} /></span>
                  <div className="flex-1">
                    <D.Title className="font-display text-lg leading-tight">Companion</D.Title>
                    <D.Description className="text-[11px] text-graphite">
                      {config.data?.llm.status === "configured" ? `Grounded in your records · ${config.data.llm.message}` : "Grounded in your MentorOS records"}
                    </D.Description>
                  </div>
                  {messages.length > 0 && <button onClick={reset} aria-label="Clear conversation" className="grid h-8 w-8 place-items-center rounded-md text-graphite hover:bg-ink/5"><Eraser size={16} /></button>}
                  <D.Close aria-label="Close" className="grid h-8 w-8 place-items-center rounded-md text-graphite hover:bg-ink/5"><X size={18} /></D.Close>
                </div>
                <div ref={scroller} className="flex-1 overflow-y-auto px-5 py-5">
                  {messages.length === 0 && !history.isLoading && (
                    <div className="pt-6">
                      <p className="font-display text-[1.7rem] leading-[1.05] tracking-[-0.03em]">
                        {me?.role === "student" ? "What would you like to understand about your term?" : "What should we look at first?"}
                      </p>
                      <p className="mt-2 text-sm text-graphite">I answer from live data you're allowed to see — scores, attendance, meetings, alerts — and from the institute's policies.</p>
                    </div>
                  )}
                  <ul className="space-y-5">
                    {messages.map((m, i) => (
                      <motion.li key={m.id ?? i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }} className={cn(m.role === "user" && "flex justify-end")}>
                        {m.role === "user" ? (
                          <div className="max-w-[85%] rounded-lg rounded-br-sm bg-ink px-3.5 py-2 text-sm text-paper">{m.content}</div>
                        ) : m.pending ? <Writing /> : (
                          <div className="space-y-3">
                            <div className="prose-note text-[14px] leading-relaxed text-ink-soft"><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown></div>
                            {m.cards?.map((c, k) => <Card key={k} card={c} />)}
                            {!!m.sources?.length && (
                              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-graphite"><BookOpen size={12} />{m.sources.map((s) => <span key={s.title} className="rounded-full bg-ink/[0.05] px-2 py-0.5">{s.title}</span>)}</div>
                            )}
                          </div>
                        )}
                      </motion.li>
                    ))}
                  </ul>
                </div>
                <div className="border-t border-rule/10 bg-sheet px-4 pb-4 pt-3">
                  {!send.isPending && lastSuggestions.length > 0 && (
                    <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
                      {lastSuggestions.slice(0, 4).map((s) => (
                        <button key={s} onClick={() => submit(s)} className="shrink-0 rounded-full bg-paper-deep/70 px-3 py-1.5 text-xs text-ink-soft hairline transition-colors hover:bg-pen-wash hover:text-pen-deep">{s}</button>
                      ))}
                    </div>
                  )}
                  <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex items-end gap-2 rounded-lg bg-sheet-raised p-1.5 shadow-inset hairline focus-within:shadow-pen">
                    <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1} maxLength={1500} placeholder="Ask anything about your data…"
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
                      className="max-h-32 min-h-[38px] flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-graphite-light" aria-label="Message the companion" />
                    <button type="submit" disabled={!input.trim() || send.isPending} aria-label="Send" className="grid h-9 w-9 place-items-center rounded-md bg-ink text-paper transition-opacity disabled:opacity-30"><ArrowUp size={17} /></button>
                  </form>
                </div>
              </motion.aside>
            </D.Content>
          </D.Portal>
        )}
      </AnimatePresence>
    </D.Root>
  );
}
