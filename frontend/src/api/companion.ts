/**
 * AI Companion — frontend mock.
 *
 * `sendCompanionMessage` is the ONE function a real Claude call replaces. It
 * currently (a) matches the user's text against the FAQ knowledge base by
 * keyword and (b) dispatches two "tool calls" — `get_my_score` and
 * `schedule_meeting` — returning a structured result the UI renders distinctly
 * from plain text. The message/tool shapes are exactly what a real tool-use
 * loop would return, so the UI needs no changes when the model goes live.
 *
 * To go live: swap the body of `sendCompanionMessage` for an Anthropic
 * Messages API call (model: "claude-opus-4-8" or similar) with these two tools
 * defined, and map the tool_use/tool_result blocks onto `CompanionMessage`.
 */
import type { ScoreBreakdown } from "@/types";
import { DB } from "@/mock/data";
import { FAQ, COMPANION_FALLBACK } from "@/mock/companion";
import { clone } from "./client";

export type CompanionRole = "user" | "assistant";

export type ToolName = "get_my_score" | "schedule_meeting";

export interface ScoreToolResult {
  tool: "get_my_score";
  studentName: string;
  breakdown: ScoreBreakdown;
}

export interface MeetingToolResult {
  tool: "schedule_meeting";
  scheduled_for: string;
  mode: string;
  mentorName: string;
}

export type ToolResult = ScoreToolResult | MeetingToolResult;

export interface CompanionMessage {
  id: string;
  role: CompanionRole;
  text: string;
  tool?: ToolResult;
  /** Quick-reply chips. */
  suggestions?: string[];
  createdAt: string;
}

export interface CompanionContext {
  studentId: string;
}

let seq = 0;
const newId = () => `msg-${Date.now()}-${++seq}`;

function reply(
  partial: Omit<CompanionMessage, "id" | "role" | "createdAt">,
): CompanionMessage {
  return { id: newId(), role: "assistant", createdAt: new Date().toISOString(), ...partial };
}

export function userMessage(text: string): CompanionMessage {
  return { id: newId(), role: "user", text, createdAt: new Date().toISOString() };
}

/* --------------------------- intent detection --------------------------- */

function wantsScore(t: string): boolean {
  return /(my|current).*(score|standing|progress)|show.*score|what.*my score|how am i doing|get_my_score/.test(
    t,
  );
}

function wantsSchedule(t: string): boolean {
  return /(schedule|book|set ?up|arrange).*(meeting|slot|appointment|mentor)|schedule_meeting|^book a meeting/.test(
    t,
  );
}

function scoreFaqMatch(t: string): { id: string; score: number } | undefined {
  let best: { id: string; score: number } | undefined;
  for (const entry of FAQ) {
    let hits = 0;
    for (const kw of entry.keywords) {
      if (t.includes(kw)) hits += kw.length > 4 ? 2 : 1;
    }
    if (hits > 0 && (!best || hits > best.score)) best = { id: entry.id, score: hits };
  }
  return best;
}

/* --------------------------- the swap point --------------------------- */

export function sendCompanionMessage(
  text: string,
  ctx: CompanionContext,
): Promise<CompanionMessage> {
  const t = text.toLowerCase().trim();

  // Variable think-time makes the typing indicator feel real.
  const latency = 650 + Math.random() * 700;

  return new Promise((resolve) => {
    window.setTimeout(() => resolve(route(t, ctx)), latency);
  });
}

function route(t: string, ctx: CompanionContext): CompanionMessage {
  const student = DB.students.find((s) => s.id === ctx.studentId);

  // Tool call: get_my_score
  if (wantsScore(t) && student) {
    return reply({
      text: `Here's where you stand right now, ${student.name.split(" ")[0]}. Each bar is the raw component before its weight is applied.`,
      tool: { tool: "get_my_score", studentName: student.name, breakdown: clone(student.score) },
      suggestions: ["How do I improve it?", "What lowers my score?"],
    });
  }

  // Tool call: schedule_meeting (creates a real entry in the mock store)
  if (wantsSchedule(t) && student) {
    const when = new Date();
    when.setDate(when.getDate() + 3);
    when.setHours(11, 0, 0, 0);
    const mentor = DB.mentors.find((m) => m.id === student.mentor_id);
    DB.meetings.push({
      id: `mtg-${Date.now()}`,
      student_id: student.id,
      mentor_id: student.mentor_id,
      scheduled_for: when.toISOString(),
      status: "scheduled",
      mode: "video",
    });
    return reply({
      text: "Done — I've put a request on your mentor's roster. They'll confirm the final time.",
      tool: {
        tool: "schedule_meeting",
        scheduled_for: when.toISOString(),
        mode: "video",
        mentorName: mentor?.name ?? "your mentor",
      },
      suggestions: ["Show my score", "What should I prepare?"],
    });
  }

  // FAQ keyword match
  const match = scoreFaqMatch(t);
  if (match) {
    const entry = FAQ.find((f) => f.id === match.id)!;
    return reply({ text: entry.answer, suggestions: entry.suggestions });
  }

  // Fallback
  return reply({
    text: COMPANION_FALLBACK,
    suggestions: ["How does my score work?", "Show my score", "Book a meeting"],
  });
}
