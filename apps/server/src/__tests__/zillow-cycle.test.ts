import { describe, it, expect } from "vitest";
import { runExclusiveCycle, isCycleBusy, CYCLE_BUSY, isCycleSkipped } from "../services/zillow-cycle.js";

/** A promise you resolve by hand — to hold a cycle open mid-test. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("runExclusiveCycle", () => {
  it("wait-mode serializes: second cycle starts only after the first finishes", async () => {
    const order: string[] = [];
    const gate = deferred<void>();
    const first = runExclusiveCycle("wait", async () => {
      order.push("a-start");
      await gate.promise;
      order.push("a-end");
      return "a";
    });
    const second = runExclusiveCycle("wait", async () => {
      order.push("b-start");
      return "b";
    });
    // Give the microtask queue a chance — b must NOT have started.
    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual(["a-start"]);
    expect(isCycleBusy()).toBe(true);
    gate.resolve();
    expect(await first).toBe("a");
    expect(await second).toBe("b");
    expect(order).toEqual(["a-start", "a-end", "b-start"]);
    expect(isCycleBusy()).toBe(false);
  });

  it("try-mode returns CYCLE_BUSY immediately while a cycle is in flight", async () => {
    const gate = deferred<void>();
    const first = runExclusiveCycle("wait", async () => {
      await gate.promise;
      return "long";
    });
    await new Promise((r) => setTimeout(r, 5));
    const skipped = await runExclusiveCycle("try", async () => "never");
    expect(isCycleSkipped(skipped)).toBe(true);
    expect(skipped).toBe(CYCLE_BUSY);
    gate.resolve();
    expect(await first).toBe("long");
    // Free again: try-mode now runs.
    const ran = await runExclusiveCycle("try", async () => "ran");
    expect(ran).toBe("ran");
  });

  it("a rejecting cycle releases the mutex and does not poison the chain", async () => {
    await expect(
      runExclusiveCycle("wait", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(isCycleBusy()).toBe(false);
    const after = await runExclusiveCycle("wait", async () => "recovered");
    expect(after).toBe("recovered");
    const tried = await runExclusiveCycle("try", async () => "tried");
    expect(tried).toBe("tried");
  });

  it("try-mode queued behind NOTHING runs; queued behind wait-chain skips", async () => {
    // Two waiters stack up; a try during the stack must skip, not enqueue third.
    const gate = deferred<void>();
    const w1 = runExclusiveCycle("wait", async () => {
      await gate.promise;
      return 1;
    });
    const w2 = runExclusiveCycle("wait", async () => 2);
    await new Promise((r) => setTimeout(r, 5));
    expect(isCycleSkipped(await runExclusiveCycle("try", async () => 3))).toBe(true);
    gate.resolve();
    expect(await w1).toBe(1);
    expect(await w2).toBe(2);
  });
});
