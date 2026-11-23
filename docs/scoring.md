# Success Score Formula — MentorOS (Agreed with Faculty)

This document formalizes the mathematical model and categorization boundaries for computing a student's **Student Success Score** at MentorOS. This model has been reviewed and approved by department faculty to act as a unified signal for early intervention.

---

## 1. Weighted Formula Model

The score is computed as a weighted linear combination of four normalized academic dimensions, yielding a final value between `0.0` and `100.0`.

$$\text{Success Score} = 0.35 \times A + 0.35 \times G + 0.15 \times E + 0.15 \times P$$

Where:
* **$A$ (Attendance Score)**: Raw class attendance percentage (Scale: 0 to 100).
* **$G$ (Academic Score)**: Normalized grade indicator derived from CGPA (Scale: 0 to 100).
* **$E$ (Engagement Score)**: Assignment timelines and LMS activity (Scale: 0 to 100).
* **$P$ (Placement Readiness Score)**: Resume logs, test participation, and certifications (Scale: 0 to 100).

---

## 2. Dimension Normalization Rules

### Attendance ($A$)
- Directly maps to the student's raw class attendance percentage.
- *Example*: 92% attendance yields a score of `92.0`.

### Academic ($G$)
- The **latest declared SGPA** (10-point scale) is mapped linearly to a 100-point scale (Phase-3 DECISION-1):
  $$G = \text{Min}(\text{SGPA} \times 10.0, 100.0)$$
- *Example*: An SGPA of 8.2 yields `82.0`. Students without a declared SGPA (first semester) are `insufficient_data`.

### Engagement ($E$)
- Mean of (LMS logins ÷ department average for the term × 100, capped at 100) and (assignments submitted ÷ assigned × 100). No LMS activity counts as 0.

### Placement ($P$)
- Resume uploaded = 40, plus 8 per listed skill (max 5) and 4 per certification (max 5), capped at 100. No profile = 0.

### Missing data
- If Attendance **or** Academic has no source data the score is `null` and the band is `insufficient_data` — never a misleading number.

> Implementation: `backend/app/scoring/formula.py` (single source of truth, unit-tested).

---

## 3. Risk Bands

Success scores correspond to one of three risk categories, determining HOD dashboard color codes and prioritizing mentor intervention schedules:

```text
[0] ────────────────────── [50] ────────────────────── [70] ────────────────────── [100]
           CORAL                        AMBER                        GREEN
        (Critical)                   (At-risk)                     (Healthy)
```

### Green (Healthy)
- **Range**: `70.0 <= Score <= 100.0`
- **Dashboard Color**: `#10b981` (Emerald/Green)
- **Faculty Guide**: Student is meeting or exceeding expectations. Standard periodic check-ins.

### Amber (At-risk)
- **Range**: `50.0 <= Score <= 69.9`
- **Dashboard Color**: `#f59e0b` (Amber/Yellow)
- **Faculty Guide**: Student is displaying secondary risk signals (such as a drop in academics or minor attendance dip). Mentors should schedule a check-in within the week.

### Coral (Critical)
- **Range**: `0.0 <= Score <= 49.9`
- **Dashboard Color**: `#ef4444` (Coral/Red)
- **Faculty Guide**: High risk of semester backlog or attendance failure. Immediate priority check-in within 48 hours required.
