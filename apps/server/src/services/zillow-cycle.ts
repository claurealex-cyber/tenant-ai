/**
 * In-process mutex for the WHOLE Zillow cycle (scrape → build → broadcast →
 * mark-sent → flip, both segments). Distinct from the GUI lock on purpose:
 * the GUI lock is NOT re-entrant and is taken INSIDE runZillowImport and around
 * each sendBroadcastViaApi call, so a cycle-level GUI lock would deadlock (S2).
 * This mutex serializes cycles; the GUI lock keeps serializing screen access.
 *
 * Modes:
 *  - "wait": queue behind any in-flight cycle (cron tick, manual auto-run —
 *    a BullMQ worker / HTTP handler may block a few seconds; S3 keeps the
 *    10/16/22 slots always claimed).
 *  - "try": return CYCLE_BUSY immediately (the fast poll — it must never queue
 *    a backlog of scrapes; the next tick simply re-evaluates).
 *
 * All entry points run through this: runDailyAutomation wraps its claimed body
 * in wait-mode, and the poll driver (M3) uses try-mode around runZillowCycle.
 */

export const CYCLE_BUSY = Object.freeze({ skipped: "cycle_busy" as const });
export type CycleBusy = typeof CYCLE_BUSY;

export function isCycleSkipped(v: unknown): v is CycleBusy {
  return v === CYCLE_BUSY;
}

let busy = false;
let chain: Promise<unknown> = Promise.resolve();

/** True while a Zillow cycle is running (for status displays; racy by nature). */
export function isCycleBusy(): boolean {
  return busy;
}

export async function runExclusiveCycle<T>(mode: "wait", fn: () => Promise<T>): Promise<T>;
export async function runExclusiveCycle<T>(mode: "try", fn: () => Promise<T>): Promise<T | CycleBusy>;
export async function runExclusiveCycle<T>(
  mode: "wait" | "try",
  fn: () => Promise<T>,
): Promise<T | CycleBusy> {
  if (mode === "try" && busy) return CYCLE_BUSY;
  const run = async (): Promise<T> => {
    busy = true;
    try {
      return await fn();
    } finally {
      busy = false;
    }
  };
  const result = chain.then(run, run); // run even if a prior cycle rejected
  chain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
