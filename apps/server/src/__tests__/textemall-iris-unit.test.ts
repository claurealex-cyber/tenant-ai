import { describe, it, expect } from "vitest";
import { parseIrisResult, buildIrisUploadGoal, irisUploadToGroup } from "../services/textemall-iris.js";
import { withGuiLock } from "../lib/gui-lock.js";

describe("parseIrisResult", () => {
  it("reads the final terminal marker", () => {
    expect(parseIrisResult("blah\nRESULT: ok").status).toBe("ok");
    expect(parseIrisResult("RESULT: needs-login").status).toBe("needs_login");
    expect(parseIrisResult("RESULT: ok\n...\nRESULT: failed").status).toBe("failed");
    expect(parseIrisResult("no marker").status).toBe("failed");
  });

  it("needs-login anywhere wins", () => {
    expect(parseIrisResult("RESULT: cleared\nRESULT: needs-login\nnoise").status).toBe("needs_login");
  });

  it("verified-count fallback: count == expected → ok even without a final ok marker", () => {
    // The exact turn-exhaustion false-negative: work done, count read, no final ok.
    expect(parseIrisResult("RESULT: cleared\nRESULT: count=2", 2).status).toBe("ok");
  });

  it("count != expected → failed with a mismatch detail", () => {
    const r = parseIrisResult("RESULT: count=1", 2);
    expect(r.status).toBe("failed");
    expect((r as { detail: string }).detail).toContain("≠ expected 2");
  });

  it("a final ok marker still wins over an earlier count", () => {
    expect(parseIrisResult("RESULT: count=1\nRESULT: ok", 2).status).toBe("ok");
  });

  it("count with no expectedCount passed → cannot verify → failed", () => {
    expect(parseIrisResult("RESULT: count=2").status).toBe("failed");
  });
});

describe("buildIrisUploadGoal", () => {
  it("embeds the path, group, expected count, one-by-one clear, and the needs-login stop", () => {
    const g = buildIrisUploadGoal({ csvPath: "/x/y.csv", group: "Ghem", expectedCount: 3 });
    expect(g).toContain("/x/y.csv");
    expect(g).toContain('"Ghem"');
    expect(g).toContain("equals 3");
    expect(g).toContain("RESULT: needs-login");
    expect(g).toContain("RESULT: count=");
    expect(g).toContain("Remove From Group");     // lean one-by-one clear
    expect(g).toContain("Everyone");               // guardrail: don't wander to other groups
  });
});

describe("irisUploadToGroup (injected run)", () => {
  it("returns ok/needs_login/failed from the run output; never throws", async () => {
    expect((await irisUploadToGroup({ csvPath: "/x.csv", group: "g", expectedCount: 1 }, { run: async () => "RESULT: ok" })).status).toBe("ok");
    expect((await irisUploadToGroup({ csvPath: "/x.csv", group: "g", expectedCount: 1 }, { run: async () => "RESULT: needs-login" })).status).toBe("needs_login");
    const thrown = await irisUploadToGroup({ csvPath: "/x.csv", group: "g", expectedCount: 1 }, { run: async () => { throw new Error("iris crashed"); } });
    expect(thrown.status).toBe("failed");
  });

  it("accepts a verified count matching expectedCount (no final ok marker needed)", async () => {
    const r = await irisUploadToGroup({ csvPath: "/x.csv", group: "g", expectedCount: 2 }, { run: async () => "RESULT: cleared\nRESULT: count=2" });
    expect(r.status).toBe("ok");
  });
});

describe("withGuiLock", () => {
  it("serializes overlapping GUI work (no two run at once)", async () => {
    let active = 0, maxActive = 0;
    const task = () => withGuiLock("t", async () => {
      active++; maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
    });
    await Promise.all([task(), task(), task()]);
    expect(maxActive).toBe(1);
  });
  it("a rejecting task doesn't wedge the lock", async () => {
    await withGuiLock("t", async () => { throw new Error("boom"); }).catch(() => {});
    const ok = await withGuiLock("t", async () => "ran");
    expect(ok).toBe("ran");
  });
});
