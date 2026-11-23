"""Pure allocation engine using a per-department min-heap."""
from __future__ import annotations

import heapq
from typing import Any

RISK_ORDER: dict[str, int] = {
    "coral": 0,
    "amber": 1,
    "insufficient_data": 2,
    "green": 3,
}


def _student_sort_key(student: dict[str, Any]) -> tuple:
    """Return a sort key that prioritises higher-risk students first."""
    return (RISK_ORDER.get(student.get("risk_status", ""), 99), student.get("score") if student.get("score") is not None else 999, student["id"])


def allocate(
    students_by_dept: dict[str, list[dict[str, Any]]],
    mentors_by_dept: dict[str, list[dict[str, Any]]],
    workload_map: dict[int, int],
) -> dict[str, Any]:
    """Run the heap-based allocation algorithm across all departments.

    Args:
        students_by_dept: Unallocated students grouped by department. Each student
            dict must contain ``id`` and ``risk_status``.
        mentors_by_dept: Mentors grouped by department. Each mentor dict must
            contain ``id`` and ``max_mentees``.
        workload_map: Current mentee counts keyed by mentor id.

    Returns:
        Dict with ``plan`` — a list of ``(student_id, mentor_id)`` pairs — and
        ``stats`` containing ``allocated``, ``skipped``, and ``by_dept`` counts.
    """
    plan: list[tuple[int, int]] = []
    total_allocated = 0
    total_skipped = 0
    by_dept: dict[str, dict[str, int]] = {}
    running_workload = dict(workload_map)

    for dept, students in students_by_dept.items():
        dept_allocated = 0
        dept_skipped = 0
        sorted_students = sorted(students, key=_student_sort_key)
        dept_mentors = mentors_by_dept.get(dept, [])

        heap: list[tuple[int, int, int, int]] = []
        counter = 0
        for mentor in dept_mentors:
            mentor_id = mentor["id"]
            max_mentees = mentor["max_mentees"]
            current = running_workload.get(mentor_id, 0)
            if current < max_mentees:
                heapq.heappush(heap, (current, counter, mentor_id, max_mentees))
                counter += 1

        for student in sorted_students:
            if not heap:
                dept_skipped += 1
                continue

            current_load, tiebreak, mentor_id, max_mentees = heapq.heappop(heap)
            student_id = student["id"]
            plan.append((student_id, mentor_id))
            dept_allocated += 1

            new_load = current_load + 1
            running_workload[mentor_id] = new_load

            if new_load < max_mentees:
                heapq.heappush(heap, (new_load, tiebreak, mentor_id, max_mentees))

        by_dept[dept] = {"allocated": dept_allocated, "skipped": dept_skipped}
        total_allocated += dept_allocated
        total_skipped += dept_skipped

    return {
        "plan": plan,
        "stats": {
            "allocated": total_allocated,
            "skipped": total_skipped,
            "by_dept": by_dept,
        },
    }
