import { describe, expect, it } from "vitest";
import { bandFor, initials, num, PILLARS, signed } from "./format";
import { qs } from "./api";

describe("score helpers", () => {
  it("bands match the faculty-agreed thresholds", () => {
    expect(bandFor(70)).toBe("green");
    expect(bandFor(69.99)).toBe("amber");
    expect(bandFor(50)).toBe("amber");
    expect(bandFor(49.9)).toBe("coral");
    expect(bandFor(null)).toBe("insufficient_data");
  });
  it("pillar weights sum to one", () => {
    expect(PILLARS.reduce((a, p) => a + p.weight, 0)).toBeCloseTo(1);
  });
  it("formats numbers and deltas", () => {
    expect(num(null)).toBe("—");
    expect(num(66.789)).toBe("66.8");
    expect(signed(2.345)).toBe("+2.3");
    expect(signed(-1.5)).toBe("−1.5");
  });
  it("derives initials without academic titles", () => {
    expect(initials("Dr. Meera Iyer")).toBe("MI");
    expect(initials("Aarav Kulkarni")).toBe("AK");
  });
});

describe("query strings", () => {
  it("drops empty values", () => {
    expect(qs({ q: "", band: "coral", page: 2, unassigned: false, x: undefined })).toBe("?band=coral&page=2");
    expect(qs({})).toBe("");
  });
});
