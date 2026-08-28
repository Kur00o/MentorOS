import { useState } from "react";
import { ClipboardCheck, Plus, Trash2 } from "lucide-react";
import type { ActionItem, MeetingLog } from "@/types";
import { logMeeting, recordMeeting } from "@/api";
import { Button, Input, Modal, Textarea } from "@/components/primitives";
import { toast } from "@/store/useToast";
import { cn } from "@/lib/utils";

const TOPIC_OPTIONS = [
  "Attendance recovery",
  "Mid-sem review",
  "Backlog clearance",
  "Placement prep",
  "Resume & skills",
  "Time management",
  "Project guidance",
  "Course selection",
  "Submission gaps",
  "Wellbeing check-in",
];

interface DraftAction {
  text: string;
  owner: ActionItem["owner"];
}

export function LogMeetingModal({
  open,
  onClose,
  studentId,
  studentName,
  meetingId,
  scheduledFor,
  onLogged,
}: {
  open: boolean;
  onClose: () => void;
  studentId: number;
  studentName: string;
  /** When closing out a pre-scheduled meeting. */
  meetingId?: string;
  scheduledFor?: string;
  onLogged?: () => void;
}) {
  const [topics, setTopics] = useState<string[]>([]);
  const [summary, setSummary] = useState("");
  const [actions, setActions] = useState<DraftAction[]>([{ text: "", owner: "student" }]);
  const [nextDate, setNextDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  const firstName = studentName.split(" ")[0];

  function reset() {
    setTopics([]);
    setSummary("");
    setActions([{ text: "", owner: "student" }]);
    setNextDate("");
    setError(undefined);
  }

  function toggleTopic(t: string) {
    setTopics((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  async function submit() {
    if (topics.length === 0) {
      setError("Pick at least one topic you covered.");
      return;
    }
    setError(undefined);
    setSubmitting(true);

    const action_items: ActionItem[] = actions
      .filter((a) => a.text.trim())
      .map((a, i) => ({ id: `ai-${Date.now()}-${i}`, text: a.text.trim(), owner: a.owner, done: false }));

    const log: MeetingLog = {
      topics,
      summary: summary.trim(),
      action_items,
      next_meeting_date: nextDate ? new Date(`${nextDate}T11:00`).toISOString() : undefined,
      logged_at: new Date().toISOString(),
    };

    try {
      if (meetingId) {
        await logMeeting(meetingId, log);
      } else {
        await recordMeeting({
          student_id: studentId,
          scheduled_for: scheduledFor ?? new Date().toISOString(),
          mode: "in-person",
          log,
        });
      }
      toast.success(`Meeting with ${firstName} logged.`);
      onLogged?.();
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save meeting log.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={`Log your meeting with ${firstName}`}
      description="Capture it as structured notes — topics, action items and a follow-up date."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting} iconLeft={<ClipboardCheck size={16} />}>
            {submitting ? "Saving…" : "Save meeting log"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {/* Topics */}
        <div>
          <p className="mb-2 text-caption font-medium text-ink">
            Topics covered <span className="text-signal-coral">*</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {TOPIC_OPTIONS.map((t) => {
              const on = topics.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleTopic(t)}
                  aria-pressed={on}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-caption transition-colors",
                    on
                      ? "border-azure-500 bg-azure-200/60 font-medium text-azure-600"
                      : "border-ink/8 bg-white/60 text-ink-soft hover:border-azure-200 hover:text-ink",
                  )}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>

        {/* Action items */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-caption font-medium text-ink">Action items</p>
            <button
              type="button"
              onClick={() => setActions((a) => [...a, { text: "", owner: "student" }])}
              className="flex items-center gap-1 text-caption font-medium text-azure-600 hover:text-azure-500"
            >
              <Plus size={14} /> Add item
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {actions.map((a, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={a.text}
                  onChange={(e) =>
                    setActions((prev) => prev.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))
                  }
                  placeholder="e.g. Submit pending assignments by Friday"
                  className="h-11 flex-1 rounded-sm border border-ink/8 bg-white/70 px-3 text-body text-ink placeholder:text-ink-soft/60 focus:border-azure-500 focus:outline-none focus:ring-2 focus:ring-azure-200"
                />
                <select
                  value={a.owner}
                  onChange={(e) =>
                    setActions((prev) =>
                      prev.map((x, j) => (j === i ? { ...x, owner: e.target.value as DraftAction["owner"] } : x)),
                    )
                  }
                  className="h-11 w-28 cursor-pointer rounded-sm border border-ink/8 bg-white/70 px-2 text-caption text-ink focus:border-azure-500 focus:outline-none focus:ring-2 focus:ring-azure-200"
                  aria-label="Owner"
                >
                  <option value="student">Student</option>
                  <option value="mentor">Mentor</option>
                </select>
                <button
                  type="button"
                  onClick={() => setActions((prev) => prev.filter((_, j) => j !== i))}
                  disabled={actions.length === 1}
                  aria-label="Remove action item"
                  className="rounded-sm p-2 text-ink-soft hover:bg-ink/4 hover:text-signal-coral disabled:opacity-40"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Follow-up + summary */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Next meeting"
            type="date"
            value={nextDate}
            mono
            min={new Date().toISOString().slice(0, 10)}
            hint="Optional — schedule a follow-up."
            onChange={(e) => setNextDate(e.target.value)}
          />
          <Textarea
            label="Summary"
            value={summary}
            rows={3}
            placeholder="A sentence or two on how it went."
            hint="Optional."
            onChange={(e) => setSummary(e.target.value)}
          />
        </div>

        {error && <p className="text-caption text-signal-coral">{error}</p>}
      </div>
    </Modal>
  );
}
