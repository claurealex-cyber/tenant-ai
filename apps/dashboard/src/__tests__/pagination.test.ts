import { describe, it, expect, vi } from "vitest";

// Mock React's useCallback to be a passthrough (no component context needed)
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useCallback: <T extends (...args: any[]) => any>(fn: T) => fn,
  };
});

import { usePagination } from "../components/Pagination";

describe("usePagination", () => {
  it("calculates totalPages for 100 items with pageSize 25", () => {
    const { totalPages } = usePagination(100, 25);
    expect(totalPages).toBe(4);
  });

  it("returns totalPages 1 for 0 items (Math.max(1, ...))", () => {
    const { totalPages } = usePagination(0, 25);
    expect(totalPages).toBe(1);
  });

  it("returns totalPages 1 when count equals pageSize", () => {
    const { totalPages } = usePagination(25, 25);
    expect(totalPages).toBe(1);
  });

  it("returns totalPages 2 when count exceeds pageSize by 1", () => {
    const { totalPages } = usePagination(26, 25);
    expect(totalPages).toBe(2);
  });

  it("getSkip returns correct offset for each page", () => {
    const { getSkip } = usePagination(100, 25);
    expect(getSkip(1)).toBe(0);
    expect(getSkip(2)).toBe(25);
    expect(getSkip(3)).toBe(50);
  });

  it("returns the pageSize that was passed in", () => {
    const { pageSize } = usePagination(100, 10);
    expect(pageSize).toBe(10);
  });
});
