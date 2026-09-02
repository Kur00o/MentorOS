/**
 * The ONLY place that knows data is mocked.
 *
 * Every `/src/api` function resolves through `respond()`, which today returns
 * in-memory mock data after a short artificial delay. To go live, replace the
 * body of `respond()` (and the individual calls) with `fetch(...)` — no
 * component changes required. See the backend hand-off contract in Section 4.
 */

const DEFAULT_LATENCY: [number, number] = [180, 420];

export function isDemoMode(): boolean {
  return typeof window !== "undefined" && window.location.pathname.startsWith("/demo/");
}

function jitter([min, max]: [number, number]): number {
  return min + Math.random() * (max - min);
}

/** Simulate a network round-trip returning JSON. */
export function respond<T>(
  data: T | (() => T),
  latency: [number, number] = DEFAULT_LATENCY,
): Promise<T> {
  return new Promise((resolve) => {
    window.setTimeout(
      () => resolve(typeof data === "function" ? (data as () => T)() : data),
      jitter(latency),
    );
  });
}

/** Deep clone so callers can't accidentally mutate the in-memory store. */
export function clone<T>(value: T): T {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T);
}
