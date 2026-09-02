import { useState } from "react";
import { CalendarPlus } from "lucide-react";
import type { Meeting } from "@/types";
import { scheduleMeeting } from "@/api";
import { Button, Modal, Select, Input } from "@/components/primitives";
import { toast } from "@/store/useToast";

function tomorrowISODate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function ScheduleMeetingModal({
  open,
  onClose,
  studentId,
  studentName,
  onScheduled,
}: {
  open: boolean;
  onClose: () => void;
  studentId: number;
  studentName: string;
  onScheduled?: (m: Meeting) => void;
}) {
  const [date, setDate] = useState(tomorrowISODate());
  const [time, setTime] = useState("11:00");
  const [mode, setMode] = useState<Meeting["mode"]>("video");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  const firstName = studentName.split(" ")[0];

  async function submit() {
    const when = new Date(`${date}T${time}`);
    if (Number.isNaN(when.getTime()) || when.getTime() < Date.now()) {
      setError("Pick a date and time in the future.");
      return;
    }
    setError(undefined);
    setSubmitting(true);
    try {
      const meeting = await scheduleMeeting({
        student_id: studentId,
        scheduled_for: when.toISOString(),
        mode,
      });
      toast.success(`Meeting scheduled with ${firstName}.`);
      onScheduled?.(meeting);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Meeting could not be scheduled.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Schedule a meeting with ${firstName}`}
      description="They'll see it on their side straight away. You can log notes after it happens."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting} iconLeft={<CalendarPlus size={16} />}>
            {submitting ? "Scheduling…" : "Schedule meeting"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Date"
            type="date"
            value={date}
            min={tomorrowISODate()}
            mono
            onChange={(e) => setDate(e.target.value)}
          />
          <Input
            label="Time"
            type="time"
            value={time}
            mono
            onChange={(e) => setTime(e.target.value)}
          />
        </div>
        <Select label="Mode" value={mode} onChange={(e) => setMode(e.target.value as Meeting["mode"])}>
          <option value="video">Video call</option>
          <option value="in-person">In person</option>
          <option value="phone">Phone</option>
        </Select>
        {error && <p className="text-caption text-signal-coral">{error}</p>}
      </div>
    </Modal>
  );
}
