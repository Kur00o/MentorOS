import pytest

from backend.app.scoring import formula


def test_weights_sum_to_one():
    assert sum(formula.WEIGHTS.values()) == pytest.approx(1.0)


def test_compose_matches_documented_formula():
    r = formula.compose(90, 80, 70, 60)
    assert r.total_score == pytest.approx(0.35 * 90 + 0.35 * 80 + 0.15 * 70 + 0.15 * 60)
    assert r.risk_category == "green"


@pytest.mark.parametrize("total,band", [(70, "green"), (69.99, "amber"), (50, "amber"), (49.99, "coral"), (0, "coral"), (None, "insufficient_data")])
def test_band_boundaries(total, band):
    assert formula.risk_band(total) == band


def test_missing_pillar_is_insufficient_not_zero():
    assert formula.compose(None, 80, 70, 60).risk_category == "insufficient_data"
    assert formula.compose(90, None, 70, 60).total_score is None
    # engagement/placement missing are treated as 0, not insufficient
    assert formula.compose(90, 80, None, None).total_score == pytest.approx(0.35 * 90 + 0.35 * 80)


def test_attendance_is_weighted_by_classes():
    assert formula.attendance_component([(9, 10), (1, 10)]) == 50.0
    assert formula.attendance_component([(10, 10), (0, 0)]) == 100.0
    assert formula.attendance_component([]) is None


def test_academic_from_sgpa_capped():
    assert formula.academic_component(8.2) == 82.0
    assert formula.academic_component(10.0) == 100.0
    assert formula.academic_component(None) is None


def test_engagement_vs_cohort():
    assert formula.engagement_component(100, 50, 10, 10) == 100.0
    assert formula.engagement_component(25, 50, 5, 10) == 50.0
    assert formula.engagement_component(0, 50, 0, 10) is None


def test_placement_caps():
    assert formula.placement_component(True, 5, 5) == 100.0
    assert formula.placement_component(True, 9, 9) == 100.0
    assert formula.placement_component(False, 2, 1) == 20.0


@pytest.mark.parametrize("attended,total", [(30, 50), (60, 80), (10, 40), (74, 100)])
def test_classes_needed_reaches_threshold(attended, total):
    n = formula.classes_needed_for(attended, total)
    assert (attended + n) / (total + n) * 100 >= 75
    if n:
        assert (attended + n - 1) / (total + n - 1) * 100 < 75


@pytest.mark.parametrize("attended,total", [(90, 100), (40, 50), (75, 100)])
def test_classes_can_skip_keeps_threshold(attended, total):
    k = formula.classes_can_skip(attended, total)
    assert attended / (total + k) * 100 >= 75
    assert attended / (total + k + 1) * 100 < 75


def test_weakest_component_is_largest_weighted_gap():
    r = formula.compose(95, 95, 20, 90)
    assert formula.weakest_component(r) == "engagement"
