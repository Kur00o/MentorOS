# MentorOS FAQ

## What is MentorOS?
MentorOS is a mentoring and early-warning platform for engineering institutes. It turns attendance, academics, LMS engagement and placement readiness into one explainable Student Success Score so students, mentors, HODs and admins act on the same signal instead of scattered spreadsheets.

## Who can use MentorOS?
There are four roles. Students see their own score, attendance, marks, meetings and privacy settings. Mentors (faculty) see their assigned mentees, schedule and log meetings, and act on risk alerts. HODs see department analytics, mentor workload and run mentor allocation. Admins manage users, departments, data imports, exports and integrations.

## How does mentor allocation work?
Students are only ever allocated to a mentor from the same department. A mentor never exceeds their capacity (20 mentees by default). Auto-allocation fills mentors with the lowest load first so rosters stay balanced within one student, and it always matches Coral and Amber students before Green ones. HODs can also assign or reassign students manually, with a reason that is kept in the allocation history.

## How do I log a meeting with my mentee?
Open the meeting from your agenda after it has started and choose "Log meeting". Write a short summary, add discussion topics and concrete action items (with optional due dates), note how the student seemed, and optionally a private note that only staff can see. Logging marks the meeting completed and the student is notified that notes and action items are ready.

## How do I request a meeting with my mentor?
Students can open Meetings and choose "Request a meeting". Pick a time, a mode (in person, video or phone) and write what you want to discuss. Your mentor receives a notification and confirms or reschedules it.

## What is the AI Companion?
The AI Companion answers questions using your real MentorOS data and the institute's knowledge base. Students can ask how their score is calculated, how many classes they need to attend, or what to focus on. Mentors can ask who needs attention or for a briefing before a meeting. HODs and admins can ask for department and system summaries. It only sees data your role is allowed to see.

## Is the data in this deployment real?
No. The current deployment is populated with clearly-labelled synthetic demo data (USNs start with DEMO and emails end with @mentoros.demo). Synthetic data is tagged in the database and can be purged in one step before real institutional data is imported.
