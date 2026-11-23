"""Deterministic synthetic institution for demos and testing.

Every row is tagged `is_synthetic=True` and linked to the `synthetic-demo-v1`
data batch, USNs start with `DEMO` and emails use the reserved demo domain, so
synthetic data can never be mistaken for — or mixed into — real records.

Students follow behavioural archetypes (thriving, steady, slipping,
struggling, disengaged, fresher) whose signals are simulated week by week, and
scores are computed with the *real* formula, so every chart, alert and score
in the demo is internally consistent.
"""
from __future__ import annotations

import math
import random
import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Optional

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from backend.app.core.config import settings
from backend.app.models import (
    AcademicTerm,
    Allocation,
    AttendanceRecord,
    AttendanceWeekly,
    AuditLog,
    CompanionMessage,
    DataBatch,
    Department,
    LmsActivity,
    LmsWeekly,
    MarkRecord,
    Meeting,
    MeetingLog,
    Mentor,
    Notification,
    PlacementOffer,
    PlacementProfile,
    SemesterResult,
    Student,
    StudentConsent,
    StudentSuccessScore,
    Subject,
    User,
)
from backend.app.scoring import formula
from backend.app.scoring.engine import recompute

BATCH_LABEL = "synthetic-demo-v1"
TERM_START = date(2026, 7, 20)  # Monday, week 1 of 2026-ODD
UTC = timezone.utc

FIRST_F = ["Aanya", "Diya", "Ishita", "Kavya", "Meera", "Nandini", "Pooja", "Riya", "Saanvi", "Tanvi", "Anika", "Shreya", "Aditi", "Gauri",
           "Ira", "Janhavi", "Mrunal", "Neha", "Pranjal", "Radhika", "Sakshi", "Sneha", "Trisha", "Vaishnavi", "Zoya", "Fatima", "Harleen",
           "Lavanya", "Mahima", "Rutuja", "Simran", "Aarohi", "Bhavna", "Charvi", "Esha", "Kritika", "Manasi", "Nikita", "Payal", "Sana"]
FIRST_M = ["Aarav", "Vihaan", "Arjun", "Kabir", "Reyansh", "Aditya", "Ishaan", "Rohan", "Siddharth", "Atharva", "Om", "Pranav", "Yash",
           "Harsh", "Kunal", "Nikhil", "Omkar", "Parth", "Rahul", "Sahil", "Tanmay", "Varun", "Vedant", "Aryan", "Dhruv", "Gaurav", "Imran",
           "Jay", "Karan", "Manav", "Neel", "Rushikesh", "Sarthak", "Shubham", "Soham", "Tejas", "Yuvraj", "Zaid", "Amey", "Chinmay"]
LAST = ["Kulkarni", "Deshpande", "Joshi", "Patil", "Shinde", "Pawar", "Jadhav", "Gokhale", "Bhosale", "Chavan", "Iyer", "Nair", "Menon",
        "Reddy", "Rao", "Sharma", "Verma", "Gupta", "Agarwal", "Mehta", "Shah", "Desai", "Bhatt", "Chatterjee", "Banerjee", "Das", "Sen",
        "Mukherjee", "Singh", "Gill", "Khan", "Qureshi", "D'Souza", "Fernandes", "Pillai", "Krishnan", "Naidu", "Hegde", "Shetty", "Kamath",
        "Bapat", "Apte", "Ranade", "Sathe", "Mane", "More", "Thakur", "Mishra", "Tiwari", "Saxena"]
CITIES = ["Pune", "Mumbai", "Nashik", "Nagpur", "Aurangabad", "Kolhapur", "Satara", "Solapur", "Indore", "Bhopal", "Hyderabad", "Bengaluru",
          "Jaipur", "Lucknow", "Patna", "Raipur", "Goa", "Surat", "Ahmedabad", "Delhi"]

DEPARTMENTS = [
    ("CSE", "Computer Science & Engineering", 60),
    ("ECE", "Electronics & Communication Engineering", 45),
    ("ME", "Mechanical Engineering", 45),
]
SUBJECTS = {
    "CSE": {
        1: ["Engineering Mathematics I", "Programming in C", "Engineering Physics", "Basic Electrical Engineering", "C Programming Lab"],
        3: ["Data Structures", "Discrete Mathematics", "Digital Logic Design", "Object Oriented Programming", "Data Structures Lab"],
        5: ["Operating Systems", "Database Management Systems", "Computer Networks", "Theory of Computation", "DBMS Lab"],
        7: ["Machine Learning", "Cloud Computing", "Compiler Design", "Information Security", "ML Lab"],
    },
    "ECE": {
        1: ["Engineering Mathematics I", "Basic Electronics", "Engineering Chemistry", "Engineering Graphics", "Electronics Workshop"],
        3: ["Network Analysis", "Analog Circuits", "Signals & Systems", "Digital Electronics", "Analog Circuits Lab"],
        5: ["Microprocessors", "Communication Systems", "Control Systems", "Electromagnetic Waves", "Microprocessor Lab"],
        7: ["VLSI Design", "Embedded Systems", "Wireless Communication", "Digital Signal Processing", "VLSI Lab"],
    },
    "ME": {
        1: ["Engineering Mathematics I", "Engineering Mechanics", "Engineering Physics", "Workshop Practice", "Engineering Drawing Lab"],
        3: ["Thermodynamics", "Strength of Materials", "Manufacturing Processes", "Material Science", "Manufacturing Lab"],
        5: ["Heat Transfer", "Theory of Machines", "Fluid Mechanics", "Design of Machine Elements", "Fluid Mechanics Lab"],
        7: ["Automobile Engineering", "Finite Element Analysis", "Refrigeration & Air Conditioning", "Industrial Engineering", "CAD/CAM Lab"],
    },
}
SKILLS = {
    "CSE": ["Python", "Java", "C++", "SQL", "React", "Node.js", "Docker", "AWS", "Machine Learning", "Git", "Data Structures", "Linux", "TypeScript", "Kubernetes"],
    "ECE": ["Embedded C", "Verilog", "MATLAB", "PCB Design", "Arduino", "Python", "VHDL", "IoT", "Signal Processing", "LabVIEW", "Raspberry Pi", "RTOS"],
    "ME": ["AutoCAD", "SolidWorks", "CATIA", "ANSYS", "MATLAB", "GD&T", "Six Sigma", "Python", "CNC Programming", "Lean Manufacturing", "Creo", "HyperMesh"],
}
CERTS = {
    "CSE": ["AWS Cloud Practitioner", "Google Data Analytics", "Oracle Java SE", "Meta Front-End Developer", "Azure Fundamentals", "NPTEL DSA", "TensorFlow Developer"],
    "ECE": ["NPTEL VLSI Design", "Cisco CCNA", "Embedded Systems (NPTEL)", "MATLAB Onramp", "IoT Fundamentals", "ARM Cortex-M Basics"],
    "ME": ["SolidWorks CSWA", "Six Sigma Green Belt", "AutoCAD Certified User", "ANSYS Simulation", "NPTEL Thermodynamics", "Lean Practitioner"],
}
COMPANIES = [("Northwind Systems", 6.5), ("Sahyadri Tech Labs", 8.0), ("Deccan Analytics", 9.5), ("Kaveri Cloud", 12.0), ("Indus Motors", 7.2),
             ("Konkan Robotics", 10.5), ("Varaha Semiconductors", 14.0), ("Pune Digital Works", 5.5), ("Godavari Energy", 6.8), ("Narmada Fintech", 11.0)]
ROLES = {"CSE": ["Software Engineer", "Data Analyst", "Cloud Engineer", "SDE Intern"], "ECE": ["Embedded Engineer", "VLSI Trainee", "Network Engineer", "Firmware Developer"],
         "ME": ["Design Engineer", "Graduate Engineer Trainee", "Production Engineer", "CAE Analyst"]}

ARCHETYPES = {
    # attendance p, sgpa mean, marks pct, login factor, submission rate, resume prob, trend (attendance drift in last weeks)
    "thriving":   dict(att=0.92, sgpa=8.8, marks=0.80, logins=1.25, sub=0.97, resume=0.95, skills=(4, 7), certs=(2, 6), trend=0.0, inactive=(0, 3)),
    "steady":     dict(att=0.84, sgpa=7.6, marks=0.66, logins=1.0, sub=0.85, resume=0.75, skills=(3, 6), certs=(1, 4), trend=0.0, inactive=(0, 6)),
    "slipping":   dict(att=0.82, sgpa=7.0, marks=0.55, logins=0.85, sub=0.70, resume=0.55, skills=(2, 5), certs=(0, 3), trend=-0.24, inactive=(4, 12)),
    "struggling": dict(att=0.66, sgpa=5.8, marks=0.40, logins=0.65, sub=0.50, resume=0.30, skills=(0, 3), certs=(0, 2), trend=-0.05, inactive=(5, 18)),
    "disengaged": dict(att=0.55, sgpa=5.0, marks=0.33, logins=0.30, sub=0.30, resume=0.15, skills=(0, 2), certs=(0, 1), trend=-0.10, inactive=(16, 40)),
}
ARCH_WEIGHTS = [("thriving", 0.30), ("steady", 0.33), ("slipping", 0.15), ("struggling", 0.13), ("disengaged", 0.09)]

MENTOR_NAMES = {
    "CSE": [("Dr. Meera Iyer", "Associate Professor", "Machine Learning"), ("Prof. Sameer Kulkarni", "Assistant Professor", "Distributed Systems"),
            ("Dr. Farah Qureshi", "Associate Professor", "Databases"), ("Prof. Nikhil Bapat", "Assistant Professor", "Computer Networks")],
    "ECE": [("Dr. Kavitha Menon", "Associate Professor", "VLSI"), ("Prof. Arvind Joshi", "Assistant Professor", "Embedded Systems"),
            ("Dr. Sunita Rao", "Assistant Professor", "Communication Systems")],
    "ME": [("Dr. Prakash Shinde", "Associate Professor", "Thermal Engineering"), ("Prof. Leena D'Souza", "Assistant Professor", "Design"),
           ("Dr. Vivek Chavan", "Assistant Professor", "Manufacturing")],
}
HODS = {"CSE": "Dr. Rajesh Deshpande", "ECE": "Dr. Anjali Banerjee", "ME": "Dr. Suresh Patil"}
ADMINS = [("Ananya Rao", "admin"), ("Kiran Mehta", "it.admin")]

TOPICS = {
    "thriving": ["career goals", "internship planning", "research interests", "higher studies"],
    "steady": ["exam preparation", "time management", "project ideas", "placement prep"],
    "slipping": ["attendance", "workload balance", "internal assessments", "motivation"],
    "struggling": ["backlog plan", "attendance recovery", "study habits", "subject difficulty"],
    "disengaged": ["attendance recovery", "wellbeing check-in", "LMS engagement", "family situation"],
}
SUMMARIES = {
    "thriving": ["Strong term so far. Discussed internship applications and a possible research project with faculty.",
                 "On track in every subject. Talked through higher-studies options and GRE timelines."],
    "steady": ["Consistent performance. Agreed on a revision plan before the second internal assessment.",
               "Doing well overall; wants to strengthen the placement profile with one more certification."],
    "slipping": ["Attendance has dipped over the last few weeks due to a heavy project load. Agreed to rebalance commitments.",
                 "Internal marks lower than last term. Student feels stretched; made a weekly study timetable together."],
    "struggling": ["Reviewed attendance shortage and backlog. Student will attend remedial sessions and meet subject faculty.",
                   "Discussed difficulty in core subjects. Connected the student with a peer study group."],
    "disengaged": ["Student has been largely absent. Checked in on wellbeing; will involve guardian if attendance does not recover.",
                   "Low LMS activity and attendance. Student cited commuting issues; explored hostel options and a recovery plan."],
}
ACTIONS = {
    "thriving": ["Shortlist three internship applications", "Draft a research proposal outline", "Update LinkedIn profile"],
    "steady": ["Complete pending DBMS assignment", "Finish one online certification", "Revise unit 3 before internal 2"],
    "slipping": ["Attend all classes for the next two weeks", "Submit pending LMS assignments", "Meet subject faculty for internal 2 prep"],
    "struggling": ["Attend remedial sessions every Saturday", "Register for supplementary exam", "Share weekly attendance screenshot with mentor"],
    "disengaged": ["Attend every class next week", "Log into LMS daily and submit overdue work", "Guardian meeting to be scheduled"],
}


@dataclass
class Profile:
    archetype: str
    att: float
    sgpa: float
    marks: float
    logins: float
    sub: float


def _weeks_elapsed(today: date) -> int:
    return max(4, min(20, (today - TERM_START).days // 7))


def _clip(v, lo, hi):
    return max(lo, min(hi, v))


def _binom(rng: random.Random, n: int, p: float) -> int:
    p = _clip(p, 0.0, 1.0)
    return sum(1 for _ in range(n) if rng.random() < p)


def _dt(d: date, hour: int = 10, minute: int = 0) -> datetime:
    return datetime.combine(d, time(hour, minute), tzinfo=UTC)


def clear_synthetic(db: Session) -> None:
    """Remove a previous synthetic batch (institutional rows are untouched)."""
    syn_users = select(User.id).where(User.is_synthetic.is_(True))
    db.execute(delete(CompanionMessage).where(CompanionMessage.user_id.in_(syn_users)))
    db.execute(delete(AuditLog).where(AuditLog.user_id.in_(syn_users)))
    db.execute(delete(Notification).where(Notification.user_id.in_(syn_users)))
    db.execute(Department.__table__.update().where(Department.is_synthetic.is_(True)).values(hod_user_id=None))
    db.execute(delete(Student).where(Student.is_synthetic.is_(True)))
    db.execute(delete(Mentor).where(Mentor.is_synthetic.is_(True)))
    db.execute(delete(User).where(User.is_synthetic.is_(True)))
    db.execute(delete(Subject).where(Subject.is_synthetic.is_(True)))
    db.execute(delete(Department).where(Department.is_synthetic.is_(True)))
    db.execute(delete(DataBatch).where(DataBatch.label == BATCH_LABEL))
    db.commit()


def generate(db: Session, *, seed: int = 2026, today: Optional[date] = None) -> dict:
    rng = random.Random(seed)
    today = today or datetime.now(UTC).date()
    now = datetime.now(UTC)
    period = settings.SCORING_PERIOD
    weeks = _weeks_elapsed(today)
    domain = settings.DEMO_EMAIL_DOMAIN

    clear_synthetic(db)
    batch = DataBatch(label=BATCH_LABEL, kind="synthetic", description="Synthetic demo institution generated by backend/app/seed/generator.py")
    db.add(batch)
    db.flush()
    tag = {"is_synthetic": True, "batch_id": batch.id}

    for code, name, start, end, current in [
        ("2025-ODD", "Odd term 2025–26", date(2025, 7, 21), date(2025, 12, 12), False),
        ("2026-EVEN", "Even term 2025–26", date(2026, 1, 5), date(2026, 5, 22), False),
        ("2026-ODD", "Odd term 2026–27", TERM_START, date(2026, 12, 11), True),
    ]:
        if not db.scalar(select(AcademicTerm.id).where(AcademicTerm.code == code)):
            db.add(AcademicTerm(code=code, name=name, start_date=start, end_date=end, is_current=current))

    used_emails: set[str] = set()

    def email_for(name: str) -> str:
        base = name.lower().replace("dr. ", "").replace("prof. ", "").replace("'", "").replace(" ", ".")
        e, i = f"{base}@{domain}", 2
        while e in used_emails:
            e, i = f"{base}{i}@{domain}", i + 1
        used_emails.add(e)
        return e

    def phone() -> str:
        return f"+91 9{rng.randint(100000000, 999999999)}"

    # ── departments, staff ────────────────────────────────────────────────
    depts: dict[str, Department] = {}
    for code, name, _ in DEPARTMENTS:
        d = Department(code=code, name=name, **tag)
        db.add(d)
        depts[code] = d
    db.flush()

    staff: dict[str, User] = {}
    admins = []
    for i, (name, handle) in enumerate(ADMINS):
        u = User(email=("admin@" + domain) if i == 0 else f"{handle}@{domain}", full_name=name, role="admin", phone=phone(), **tag)
        used_emails.add(u.email)
        db.add(u)
        admins.append(u)
    mentors: dict[str, list[Mentor]] = {}
    hods: dict[str, User] = {}
    for code, _, _ in DEPARTMENTS:
        hod_user = User(email=("hod@" + domain) if code == "CSE" else email_for(HODS[code]), full_name=HODS[code], role="hod",
                        department_id=depts[code].id, phone=phone(), **tag)
        used_emails.add(hod_user.email)
        db.add(hod_user)
        hods[code] = hod_user
        mentors[code] = []
        for j, (name, desig, spec) in enumerate(MENTOR_NAMES[code]):
            demo = code == "CSE" and j == 0
            u = User(email=("mentor@" + domain) if demo else email_for(name), full_name=name, role="mentor",
                     department_id=depts[code].id, phone=phone(), **tag)
            used_emails.add(u.email)
            db.add(u)
            staff[name] = u
    db.flush()
    for code, _, _ in DEPARTMENTS:
        depts[code].hod_user_id = hods[code].id
        db.add(Mentor(user_id=hods[code].id, department_id=depts[code].id, designation="Professor & Head", specialization="Department leadership",
                      office=f"{code} Block · HOD Office", max_mentees=0, is_accepting=False, **tag))
        for j, (name, desig, spec) in enumerate(MENTOR_NAMES[code]):
            m = Mentor(user_id=staff[name].id, department_id=depts[code].id, designation=desig, specialization=spec,
                       office=f"{code} Block · Cabin {201 + j}", max_mentees=16 if code != "CSE" else 15, **tag)
            db.add(m)
            mentors[code].append(m)
    db.flush()

    # ── subjects ───────────────────────────────────────────────────────────
    subjects: dict[tuple[str, int], list[Subject]] = {}
    faculty_pool = [n for code in MENTOR_NAMES for n, _, _ in MENTOR_NAMES[code]]
    for code, _, _ in DEPARTMENTS:
        prefix = {"CSE": "CS", "ECE": "EC", "ME": "ME"}[code]
        for sem, names in SUBJECTS[code].items():
            lst = []
            for k, sname in enumerate(names):
                sub = Subject(code=f"{prefix}{sem}0{k + 1}", name=sname, department_id=depts[code].id, semester=sem, credits=2 if k == 4 else 4,
                              kind="lab" if k == 4 else "theory", faculty_name=rng.choice(faculty_pool if k else [n for n, _, _ in MENTOR_NAMES[code]]), **tag)
                db.add(sub)
                lst.append(sub)
            subjects[(code, sem)] = lst
    db.flush()

    # ── students ───────────────────────────────────────────────────────────
    students: list[tuple[Student, Profile, str]] = []
    serial = {c: 0 for c, _, _ in DEPARTMENTS}
    for code, _, count in DEPARTMENTS:
        sems = [1] * 4 + [3] * int(count * 0.31) + [5] * int(count * 0.32)
        sems += [7] * (count - len(sems))
        rng.shuffle(sems)
        for idx, sem in enumerate(sems):
            female = rng.random() < 0.45
            first = rng.choice(FIRST_F if female else FIRST_M)
            name = f"{first} {rng.choice(LAST)}"
            demo_student = code == "CSE" and idx == 0
            if demo_student:
                name, female, sem = "Aarav Kulkarni", False, 5
            if sem == 1:
                arch = rng.choices(["steady", "thriving", "struggling"], [0.6, 0.25, 0.15])[0]
            else:
                arch = rng.choices([a for a, _ in ARCH_WEIGHTS], [w for _, w in ARCH_WEIGHTS])[0]
            if demo_student:
                arch = "slipping"
            a = ARCHETYPES[arch]
            prof = Profile(arch, _clip(rng.gauss(a["att"], 0.04), 0.35, 0.99), _clip(rng.gauss(a["sgpa"], 0.45), 4.2, 9.9),
                           _clip(rng.gauss(a["marks"], 0.07), 0.12, 0.97), _clip(rng.gauss(a["logins"], 0.12), 0.1, 1.8),
                           _clip(rng.gauss(a["sub"], 0.06), 0.1, 1.0))
            if demo_student:
                prof = Profile("slipping", 0.80, 6.9, 0.52, 0.8, 0.62)
            serial[code] += 1
            adm_year = 2026 - (sem - 1) // 2
            usn = f"DEMO{str(adm_year)[2:]}{code}{serial[code]:03d}"
            u = User(email=("student@" + domain) if demo_student else email_for(name), full_name=name, role="student",
                     department_id=depts[code].id, phone=phone(), **tag)
            used_emails.add(u.email)
            db.add(u)
            db.flush()
            age = 17 + (sem + 1) // 2 + rng.choice([0, 0, 1])
            st = Student(
                user=u, usn=usn, department_id=depts[code].id, semester=sem, section=rng.choice("AB"), admission_year=adm_year,
                date_of_birth=date(today.year - age, rng.randint(1, 12), rng.randint(1, 28)), gender="female" if female else "male",
                home_city=rng.choice(CITIES), hostel_resident=rng.random() < 0.42, guardian_name=f"{rng.choice(FIRST_M + FIRST_F)} {name.split()[-1]}",
                guardian_phone=phone(), guardian_email=f"guardian.{usn.lower()}@{domain}", interests=rng.sample(SKILLS[code], 2),
                bio=None, is_under_18=age < 18, status="active", **tag,
            )
            if demo_student:
                st.bio = "Third-year CSE student who loves backend systems and badminton. Currently juggling a capstone prototype and a hackathon team."
                st.interests = ["Backend systems", "Distributed computing", "Badminton"]
            db.add(st)
            students.append((st, prof, code))
    db.flush()

    # ── allocation (balanced, risk-aware; leave some unassigned for HOD demo) ─
    est = {st.id: 0.35 * p.att * 100 + 0.35 * min(p.sgpa * 10, 100) + 0.15 * (p.sub * 90) for st, p, _ in students}
    for code, _, _ in DEPARTMENTS:
        pool = [(st, p) for st, p, c in students if c == code]
        demo_st = next((st for st, p in pool if st.user.email.startswith("student@")), None)
        keep_unassigned = {st.id for st, p in sorted(pool, key=lambda x: (x[0].semester != 1, -est[x[0].id]))[: (6 if code == "CSE" else 4)]
                           if st is not demo_st}
        loads = {m.id: 0 for m in mentors[code]}
        # Demo mentor (first CSE mentor) gets a deliberately mixed, slightly at-risk roster.
        ordered = sorted(pool, key=lambda x: est[x[0].id])
        for st, p in ordered:
            if st.id in keep_unassigned:
                continue
            demo_mentor_load = loads[mentors[code][0].id]
            if (demo_st is not None and st is demo_st) or (code == "CSE" and est[st.id] < 66 and demo_mentor_load < 7):
                target = mentors[code][0]
            else:
                target = min(mentors[code], key=lambda m: (loads[m.id], rng.random()))
                if loads[target.id] >= target.max_mentees:
                    continue
            st.mentor_id = target.id
            loads[target.id] += 1
            db.add(Allocation(student_id=st.id, mentor_id=target.id, allocated_by=hods[code].id, method="seed",
                              reason="Initial allocation for term 2026-ODD", started_at=_dt(TERM_START - timedelta(days=5)), **tag))

    # ── attendance, marks, LMS, placement, results ─────────────────────────
    week_starts = [TERM_START + timedelta(weeks=w) for w in range(weeks)]
    cum_att: dict[int, list[tuple[int, int]]] = {}  # per student per week (held, attended)
    cum_lms: dict[int, list[tuple[int, int]]] = {}  # per week (logins, submissions)
    weak_subject: dict[int, int] = {}
    rows: list = []
    profiles: dict[int, PlacementProfile] = {}
    for st, p, code in students:
        subs = subjects[(code, st.semester)]
        weak_subject[st.id] = rng.randrange(len(subs))
        sub_tot = {s.id: [0, 0] for s in subs}
        weekly = []
        a = ARCHETYPES[p.archetype]
        for w in range(weeks):
            drift = a["trend"] * max(0, (w - (weeks - 5)) / 5) if a["trend"] else 0
            held_w = att_w = 0
            for k, s in enumerate(subs):
                held = rng.choice([3, 4, 4, 4, 5]) if s.kind == "theory" else 2
                if w in (8,):  # mid-term exam week
                    held = 1
                p_att = p.att + drift - ((0.09 if p.archetype in ('slipping', 'struggling', 'disengaged') else 0.05) if k == weak_subject[st.id] else 0) + rng.gauss(0, 0.04)
                got = _binom(rng, held, p_att)
                sub_tot[s.id][0] += held
                sub_tot[s.id][1] += got
                held_w += held
                att_w += got
            weekly.append((held_w, att_w))
            rows.append(AttendanceWeekly(student_id=st.id, period=period, week_index=w + 1, week_start=week_starts[w], classes_held=held_w,
                                         classes_attended=att_w, **tag))
        cum_att[st.id] = weekly
        for s in subs:
            rows.append(AttendanceRecord(student_id=st.id, subject_id=s.id, period=period, total_classes=sub_tot[s.id][0],
                                         attended_classes=sub_tot[s.id][1], source="seed", **tag))
        # internal marks
        for k, s in enumerate(subs):
            base = p.marks - (0.12 if k == weak_subject[st.id] else 0)
            plan = [("internal_1", 30, 6), ("assignment_1", 20, 9), ("internal_2", 30, 14)] if s.kind == "theory" else [("lab_record", 50, 12)]
            for name, mx, wk in plan:
                if wk > weeks:
                    continue
                pct = _clip(rng.gauss(base + (a["trend"] * 0.6 if wk >= 14 else 0), 0.09), 0.05, 1.0)
                rows.append(MarkRecord(student_id=st.id, subject_id=s.id, period=period, assessment=name, max_marks=mx,
                                       marks_obtained=round(mx * pct * 2) / 2, assessed_on=TERM_START + timedelta(weeks=wk - 1, days=3), **tag))
        # LMS
        lms_weeks = []
        total_logins = total_minutes = submitted = 0
        assignments_total = min(12, weeks * 2 // 3)
        sub_weeks = set(rng.sample(range(1, weeks + 1), assignments_total))
        for w in range(1, weeks + 1):
            drift = a["trend"] * max(0, (w - (weeks - 5)) / 5) * 2 if a["trend"] else 0
            lam = max(0.2, 4.2 * p.logins * (1 + drift))
            logins = max(0, int(rng.gauss(lam, math.sqrt(lam))))
            inactive_days = rng.randint(*a["inactive"])
            if w > weeks - inactive_days / 7:
                logins = 0
            minutes = int(logins * rng.uniform(18, 42))
            subm = 1 if (w in sub_weeks and rng.random() < p.sub and logins > 0) else 0
            total_logins += logins
            total_minutes += minutes
            submitted += subm
            lms_weeks.append((logins, subm))
            rows.append(LmsWeekly(student_id=st.id, period=period, week_index=w, logins=logins, active_minutes=minutes, submissions=subm, **tag))
        cum_lms[st.id] = lms_weeks
        last_login_week = max([i for i, (l, _) in enumerate(lms_weeks, 1) if l > 0], default=0)
        inactive = rng.randint(*a["inactive"])
        last_active = now - timedelta(days=max(inactive, (weeks - last_login_week) * 7), hours=rng.randint(1, 20))
        rows.append(LmsActivity(student_id=st.id, period=period, login_count=total_logins, active_minutes=total_minutes,
                                assignments_submitted=submitted, assignments_total=assignments_total,
                                quizzes_attempted=_binom(rng, 10, p.sub), avg_quiz_score=round(_clip(rng.gauss(p.marks * 100 + 5, 8), 10, 99), 1),
                                forum_posts=max(0, int(rng.gauss(p.logins * 4, 2))), last_active_at=last_active, **tag))
        # placement
        sem_boost = {1: -0.35, 3: -0.2, 5: 0.0, 7: 0.2}[st.semester]
        has_resume = rng.random() < _clip(a["resume"] + sem_boost, 0.02, 0.99)
        n_sk = _clip(rng.randint(*a["skills"]) + (1 if st.semester == 7 else 0) - (2 if st.semester == 1 else 0), 0, 8)
        n_ce = _clip(rng.randint(*a["certs"]) - (1 if st.semester <= 3 else 0), 0, 6)
        if st.user.email.startswith("student@"):
            has_resume, n_sk, n_ce = False, 3, 1
        status = "not_started"
        if st.semester >= 5:
            status = "preparing" if has_resume else "not_started"
        if st.semester == 7 and has_resume:
            status = rng.choices(["applying", "placed", "preparing", "higher_studies"], [0.45, 0.3 if p.archetype in ("thriving", "steady") else 0.05, 0.2, 0.05])[0]
        prof = PlacementProfile(student_id=st.id, has_resume=has_resume, resume_path=None, skills=rng.sample(SKILLS[code], n_sk),
                                certifications=rng.sample(CERTS[code], min(n_ce, len(CERTS[code]))),
                                internships=rng.choice([0, 0, 1, 1, 2]) if st.semester >= 5 and p.archetype in ("thriving", "steady") else 0,
                                mock_tests_taken=rng.randint(0, 6) if st.semester >= 5 else 0,
                                aptitude_score=round(_clip(rng.gauss(p.marks * 100, 10), 20, 98), 1) if st.semester >= 5 else None,
                                target_role=rng.choice(ROLES[code]) if st.semester >= 5 else None, status=status, **tag)
        rows.append(prof)
        profiles[st.id] = prof
        if st.semester == 7 and status in ("applying", "placed"):
            for company, ctc in rng.sample(COMPANIES, rng.randint(1, 4)):
                if status == "placed":
                    o_status = rng.choices(["accepted", "rejected", "interview"], [0.5, 0.3, 0.2])[0]
                else:
                    o_status = rng.choices(["applied", "shortlisted", "interview", "rejected", "offered"], [0.35, 0.25, 0.2, 0.15, 0.05])[0]
                rows.append(PlacementOffer(student_id=st.id, company=company, role=rng.choice(ROLES[code]), ctc_lpa=round(ctc * rng.uniform(0.85, 1.2), 1),
                                           status=o_status, stage_date=today - timedelta(days=rng.randint(3, 75)), **tag))
            if status == "placed":
                rows.append(PlacementOffer(student_id=st.id, company=rng.choice(COMPANIES)[0], role=rng.choice(ROLES[code]),
                                           ctc_lpa=round(rng.uniform(5.5, 15), 1), status="accepted", stage_date=today - timedelta(days=rng.randint(5, 40)), **tag))
        # semester results
        sgpas = []
        backlog_carry = 0
        for s in range(1, st.semester):
            sg = round(_clip(rng.gauss(p.sgpa + (0.25 if p.archetype == "slipping" and s < st.semester - 1 else 0), 0.4), 4.0, 9.95), 2)
            bl = 0
            if sg < 6.0:
                bl = rng.choice([1, 1, 2])
            elif sg < 6.8 and rng.random() < 0.25:
                bl = 1
            backlog_carry = max(0, backlog_carry - rng.choice([0, 1])) + bl
            sgpas.append(sg)
            yr = 2026 - (st.semester - s + 1) // 2
            rows.append(SemesterResult(student_id=st.id, semester=s, period=f"{yr}-{'ODD' if s % 2 else 'EVEN'}", sgpa=sg,
                                       credits_earned=max(0, 22 - 4 * bl), backlogs=bl, **tag))
        if sgpas:
            st.sgpa = sgpas[-1]
            st.cgpa = round(sum(sgpas) / len(sgpas), 2)
            st.active_backlogs = min(backlog_carry, 3)
        # consents (DPDP): most opt-in, a few decline placement sharing
        for cat in ("academic", "attendance", "placement", "wellness"):
            consented = cat != "wellness" and not (cat == "placement" and rng.random() < 0.07)
            rows.append(StudentConsent(student_id=st.id, category=cat, consented=consented, decided_at=_dt(TERM_START + timedelta(days=rng.randint(0, 20)))))
    db.add_all(rows)
    db.flush()

    # ── weekly score history using the real formula ────────────────────────
    cohort_logins: dict[tuple[str, int], float] = {}
    for code, _, _ in DEPARTMENTS:
        ids = [st.id for st, _, c in students if c == code]
        for w in range(1, weeks + 1):
            cohort_logins[(code, w)] = sum(sum(l for l, _ in cum_lms[i][:w]) for i in ids) / len(ids)
    history = []
    for st, p, code in students:
        prof = profiles[st.id]
        for w in range(3, weeks):
            held = sum(h for h, _ in cum_att[st.id][:w])
            att = sum(a for _, a in cum_att[st.id][:w])
            logins = sum(l for l, _ in cum_lms[st.id][:w])
            subm = sum(s for _, s in cum_lms[st.id][:w])
            total_assign = max(1, round(min(12, weeks * 2 // 3) * w / weeks))
            res = formula.compose(
                formula.attendance_component([(att, held)]),
                formula.academic_component(st.sgpa),
                formula.engagement_component(logins, cohort_logins[(code, w)], min(subm, total_assign), total_assign),
                formula.placement_component(prof.has_resume and w > weeks * 0.4, min(len(prof.skills), 1 + w // 4), min(len(prof.certifications), w // 6)),
            )
            history.append(StudentSuccessScore(student_id=st.id, period=period, week_index=w, attendance_component=res.attendance_component,
                                               academic_component=res.academic_component, engagement_component=res.engagement_component,
                                               placement_component=res.placement_component, total_score=res.total_score,
                                               risk_category=res.risk_category, trigger="seed", computed_at=_dt(week_starts[w - 1] + timedelta(days=6), 2), **tag))
        prev = history[-1]
        st.success_score, st.risk_category = prev.total_score, prev.risk_category
    db.add_all(history)
    db.flush()

    # ── meetings + logs ────────────────────────────────────────────────────
    meetings_rows = []
    by_mentor_slots: dict[int, set] = {}

    def slot(mentor_id: int, d: date) -> datetime:
        taken = by_mentor_slots.setdefault(mentor_id, set())
        for _ in range(30):
            hour = rng.choice([9, 10, 11, 12, 14, 15, 16])
            minute = rng.choice([0, 30])
            dt = _dt(d, hour, minute)
            if dt not in taken:
                taken.add(dt)
                return dt
            d = d + timedelta(days=1)
        return _dt(d, 17)

    for st, p, code in students:
        if not st.mentor_id:
            continue
        arch = p.archetype
        n_past = {"thriving": rng.randint(1, 2), "steady": rng.randint(1, 3), "slipping": rng.randint(2, 3), "struggling": rng.randint(2, 4), "disengaged": rng.randint(1, 3)}[arch]
        is_demo_student = st.user.email.startswith("student@")
        days_back = sorted(rng.sample(range(8, max(20, (today - TERM_START).days - 4)), n_past), reverse=True)
        if arch in ("slipping", "disengaged") and not is_demo_student and rng.random() < 0.5:
            days_back = [d for d in days_back if d > 50] or days_back[:1]  # some at-risk students not seen recently
        for i, back in enumerate(days_back):
            d = today - timedelta(days=back)
            if d.weekday() >= 5:
                d -= timedelta(days=d.weekday() - 4)
            status = "completed" if rng.random() > 0.1 else rng.choice(["cancelled", "no_show"])
            m = Meeting(mentor_id=st.mentor_id, student_id=st.id, title=rng.choice([
                "Term check-in", "Attendance review", "Internal assessment debrief", "Career & placement planning", "Mid-term mentoring session",
                "Progress review", "Academic recovery plan"]) if arch in ("slipping", "struggling", "disengaged") else rng.choice(
                ["Term check-in", "Career & placement planning", "Mid-term mentoring session", "Progress review", "Internship guidance"]),
                agenda=None, scheduled_at=slot(st.mentor_id, d), duration_minutes=rng.choice([20, 30, 30, 45]),
                mode=rng.choice(["in_person", "in_person", "video", "phone"]), location=None, status=status, requested_by=rng.choice(["mentor", "mentor", "student"]),
                created_by=None, **tag)
            if m.mode == "in_person":
                m.location = next(mm for mm in mentors[code] if mm.id == st.mentor_id).office
            elif m.mode == "video":
                m.location = "Google Meet"
            if status == "completed":
                acts = rng.sample(ACTIONS[arch], rng.randint(1, 3))
                old = i < len(days_back) - 1
                m.log = MeetingLog(summary=rng.choice(SUMMARIES[arch]), topics=rng.sample(TOPICS[arch], rng.randint(2, 3)),
                                   action_items=[{"id": uuid.UUID(int=rng.getrandbits(128)).hex[:8], "text": t, "owner": "student",
                                                  "due": (d + timedelta(days=rng.randint(7, 21))).isoformat(),
                                                  "done": old and rng.random() < 0.75} for t in acts],
                                   student_mood={"thriving": "thriving", "steady": "steady", "slipping": "stressed", "struggling": "struggling", "disengaged": "struggling"}[arch],
                                   follow_up_on=d + timedelta(days=rng.choice([14, 21, 30])),
                                   private_notes="Keep an eye on workload; check in again after the next internal." if arch in ("slipping", "struggling") else None,
                                   logged_at=_dt(d, 18), **tag)
            meetings_rows.append(m)
        # upcoming
        if is_demo_student or (arch in ("slipping", "struggling", "disengaged") and rng.random() < 0.55) or rng.random() < 0.2:
            d = today + timedelta(days=rng.randint(1, 12))
            if is_demo_student:
                d = today + timedelta(days=2)
            if d.weekday() >= 5:
                d += timedelta(days=7 - d.weekday())
            requested = rng.random() < 0.15 and not is_demo_student
            m = Meeting(mentor_id=st.mentor_id, student_id=st.id,
                        title="Attendance & workload check-in" if is_demo_student else rng.choice(["Follow-up session", "Attendance review", "Placement prep", "Progress review"]),
                        agenda="Review the attendance dip in the last three weeks and plan the capstone milestones." if is_demo_student else None,
                        scheduled_at=slot(st.mentor_id, d), duration_minutes=30, mode="in_person" if not requested else "video",
                        location=next(mm for mm in mentors[code] if mm.id == st.mentor_id).office, status="requested" if requested else "scheduled",
                        requested_by="student" if requested else "mentor", **tag)
            meetings_rows.append(m)
    # Demo mentor gets two meetings today for a lively agenda.
    demo_mentor = mentors["CSE"][0]
    roster = [st for st, _, _ in students if st.mentor_id == demo_mentor.id and not st.user.email.startswith("student@")]
    for k, st in enumerate(roster[:2]):
        meetings_rows.append(Meeting(mentor_id=demo_mentor.id, student_id=st.id, title=["Progress review", "Internship guidance"][k],
                                     scheduled_at=_dt(today, 15 + k, 30), duration_minutes=30, mode="in_person", location=demo_mentor.office,
                                     status="scheduled", requested_by="mentor", **tag))
    db.add_all(meetings_rows)
    db.flush()

    # ── final recompute: real engine → latest score, deltas, risk alerts ───
    db.commit()
    result = recompute(db, [st.id for st, _, _ in students], trigger="seed")

    # ── notifications for demo accounts ────────────────────────────────────
    demo_student = next(st for st, _, _ in students if st.user.email.startswith("student@"))
    hod_cse = hods["CSE"]
    notes = [
        (demo_student.user, "meeting_scheduled", "New mentoring session scheduled", "Attendance & workload check-in · in 2 days", "/student/meetings"),
        (demo_student.user, "risk_alert", "Your attendance is trending down", "Three-week attendance is below your term average.", "/student/attendance"),
        (demo_mentor.user, "risk_alert", "3 mentees moved to Amber this week", "Review the attention queue on your dashboard.", "/mentor"),
        (demo_mentor.user, "meeting_request", "A mentee requested a meeting", "Open your agenda to confirm.", "/mentor/meetings"),
        (hod_cse, "allocation", f"{sum(1 for st, _, c in students if c == 'CSE' and not st.mentor_id)} CSE students are waiting for a mentor", "Run allocation from the Allocation workspace.", "/hod/allocation"),
        (admins[0], "import", "Synthetic demo dataset loaded", f"{len(students)} students across {len(DEPARTMENTS)} departments.", "/admin/data"),
    ]
    for user, kind, title, body, link in notes:
        db.add(Notification(user_id=user.id, kind=kind, title=title, body=body, link=link, **tag))
    db.add(AuditLog(user_id=admins[0].id, action="seed_synthetic", entity_type="data_batch", entity_id=str(batch.id),
                    details={"students": len(students), "weeks": weeks, "seed": seed}))
    db.commit()
    return {
        "batch": BATCH_LABEL, "students": len(students), "departments": len(DEPARTMENTS),
        "mentors": sum(len(v) for v in mentors.values()), "meetings": len(meetings_rows), "weeks": weeks,
        "bands": result["bands"], "alerts_opened": result.get("alerts_opened", 0),
        "demo_accounts": {r: f"{r}@{domain}" for r in ("student", "mentor", "hod", "admin")},
    }


def demo_users(db: Session) -> list[User]:
    domain = settings.DEMO_EMAIL_DOMAIN
    return db.scalars(select(User).where(User.email.in_([f"{r}@{domain}" for r in ("student", "mentor", "hod", "admin")]))).all()

