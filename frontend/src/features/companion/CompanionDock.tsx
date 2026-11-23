import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Send, Sparkles, X } from "lucide-react";
import type { CompanionMessage } from "@/api/companion";
import { sendCompanionMessage, userMessage } from "@/api/companion";
import { useAppStore } from "@/store/useAppStore";
import { ToolResultCard } from "./ToolResultCard";
import { cn, formatTime } from "@/lib/utils";

const GREETING_TEXT = "Hi! I'm your MentorOS AI companion. I can answer questions about how the platform works, mentoring policies, and more. What would you like to know?";

const GREETING_STARTERS = [
  "What is MentorOS?",
  "How does mentor allocation work?",
  "How do I log a meeting?",
  "What is the AI companion?"
];

function greeting(): CompanionMessage {
  return {
    id: "greeting",
    role: "assistant",
    text: GREETING_TEXT,
    suggestions: GREETING_STARTERS,
    createdAt: new Date().toISOString(),
  };
}

export function CompanionDock() {
  const open = useAppStore((s) => s.companionOpen);
  const setOpen = useAppStore((s) => s.setCompanionOpen);
  const [messages, setMessages] = useState<CompanionMessage[]>([greeting()]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 250);
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || thinking) return;
    setInput("");
    setMessages((m) => [...m, userMessage(trimmed)]);
    setThinking(true);
    const reply = await sendCompanionMessage(trimmed, {});
    setThinking(false);
    setMessages((m) => [...m, reply]);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="companion"
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.98 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className="glass-quiet fixed bottom-0 right-0 z-40 flex h-[78vh] w-full flex-col overflow-hidden rounded-b-none rounded-t-lg sm:bottom-5 sm:right-5 sm:h-[560px] sm:w-[390px] sm:rounded-lg"
          role="dialog"
          aria-label="AI Companion chat"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-ink/8 bg-white/50 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-azure-500 text-white">
                <Sparkles size={16} />
              </span>
              <div>
                <p className="text-body font-semibold leading-tight text-ink">AI Companion</p>
                <p className="text-[11px] text-ink-soft">Ask me anything about MentorOS</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close companion"
              className="rounded-sm p-1.5 text-ink-soft hover:bg-ink/4 hover:text-ink"
            >
              <X size={18} />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.map((m) => (
              <MessageRow key={m.id} message={m} onSuggestion={send} disabled={thinking} />
            ))}
            {thinking && <TypingIndicator />}
          </div>

          {/* Composer */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex items-center gap-2 border-t border-ink/8 bg-white/50 p-3"
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask me anything about MentorOS…"
              aria-label="Message the AI Companion"
              className="h-11 flex-1 rounded-sm border border-ink/8 bg-white/80 px-3 text-body text-ink placeholder:text-ink-soft/60 focus:border-azure-500 focus:outline-none focus:ring-2 focus:ring-azure-200"
            />
            <button
              type="submit"
              disabled={!input.trim() || thinking}
              aria-label="Send message"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm bg-azure-500 text-white transition-colors hover:bg-azure-600 disabled:opacity-40"
            >
              <Send size={17} />
            </button>
          </form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function MessageRow({
  message,
  onSuggestion,
  disabled,
}: {
  message: CompanionMessage;
  onSuggestion: (text: string) => void;
  disabled: boolean;
}) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex animate-message-in flex-col", isUser ? "items-end" : "items-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-body",
          isUser
            ? "rounded-br-sm bg-azure-500 text-white"
            : "rounded-bl-sm bg-white/80 text-ink",
        )}
      >
        <p className="whitespace-pre-wrap leading-relaxed">{message.text}</p>
        {message.tool && <ToolResultCard result={message.tool} />}
      </div>

      {message.sources && message.sources.length > 0 && (
        <details className="mt-2 text-caption text-ink-soft">
          <summary className="cursor-pointer hover:text-ink transition-colors">
            Sources ({message.sources.length})
          </summary>
          <div className="mt-1.5 space-y-1.5 pl-2 border-l border-ink/10">
            {message.sources.map((src, i) => (
              <div key={i} className="flex flex-col">
                <span className="font-medium text-ink/80">Q: {src.question}</span>
                <span className="text-[10px] opacity-80">Match: {(src.similarity * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {message.suggestions && message.suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {message.suggestions.map((s) => (
            <button
              key={s}
              type="button"
              disabled={disabled}
              onClick={() => onSuggestion(s)}
              className="rounded-full border border-azure-200 bg-white/60 px-3 py-1 text-caption text-azure-600 transition-colors hover:bg-azure-200/50 disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <span className="mt-1 px-1 text-[10px] text-ink-soft/70">{formatTime(message.createdAt)}</span>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex animate-message-in items-center gap-1.5 rounded-2xl rounded-bl-sm bg-white/80 px-4 py-3 w-fit">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-azure-500 animate-typing-bounce"
          style={{ animationDelay: `${i * 0.16}s` }}
        />
      ))}
    </div>
  );
}
