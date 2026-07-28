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

export interface BackendSource {
  question: string;
  source_file: string;
  similarity: number;
}

export interface CompanionMessage {
  id: string;
  role: CompanionRole;
  text: string;
  tool?: ToolResult;
  /** Quick-reply chips. */
  suggestions?: string[];
  sources?: BackendSource[];
  createdAt: string;
}

export interface CompanionContext {
  studentId?: string;
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

/* --------------------------- the swap point --------------------------- */

export async function sendCompanionMessage(
  text: string,
  _ctx: CompanionContext,
): Promise<CompanionMessage> {
  try {
    const response = await fetch("http://localhost:8000/api/v1/companion/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message: text }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    
    return reply({
      text: data.answer,
      sources: data.sources,
    });
  } catch (error) {
    console.error("Companion API error:", error);
    return reply({
      text: "I'm having trouble connecting right now. Please try again in a moment.",
    });
  }
}
