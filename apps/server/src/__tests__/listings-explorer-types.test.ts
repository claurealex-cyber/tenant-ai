import { describe, it, expect } from "vitest";
import { classifyType, listingKey } from "../services/listings-explorer/types.js";

describe("classifyType (all types, skip land/co-op, signals win)", () => {
  it("skips land and co-op", () => {
    expect(classifyType("Land")).toBeNull();
    expect(classifyType("Vacant Lot")).toBeNull();
    expect(classifyType("Co-op")).toBeNull();
    expect(classifyType("Cooperative")).toBeNull();
  });
  it("maps the four kept types from labels", () => {
    expect(classifyType("Single Family")?.type).toBe("single_family");
    expect(classifyType("Condo")?.type).toBe("condo");
    expect(classifyType("Townhouse")?.type).toBe("townhome");
    expect(classifyType("Multi-Family")?.type).toBe("multi");
    expect(classifyType("Apartment")?.type).toBe("condo"); // for-sale apartment unit
  });
  it("SIGNAL override: high bed count reads as multi even if labeled single-family", () => {
    const c = classifyType("Single Family", 12, null); // the mislabeled 12-unit
    expect(c?.type).toBe("multi");
    expect(c?.source).toBe("signal");
  });
  it("unknown label + unit suffix ⇒ condo (signal)", () => {
    expect(classifyType("", 2, "3N")).toEqual({ type: "condo", source: "signal" });
  });
  it("unknown label, no unit ⇒ single_family (signal)", () => {
    expect(classifyType(null, 3, null)).toEqual({ type: "single_family", source: "signal" });
  });
});

describe("listingKey dedup (suffix normalized out, unit folded)", () => {
  it("Ave vs Avenue vs Dr collapse; unit variants fold", () => {
    expect(listingKey("1629 W North Shore Ave", "103")).toBe(listingKey("1629 W North Shore Drive", "#103"));
    expect(listingKey("500 N Damen Ave", "307")).toBe(listingKey("500 N Damen Avenue", "Unit 307"));
  });
  it("two same-price units in one building are DISTINCT keys", () => {
    expect(listingKey("6753 N Hermitage Ave", "1")).not.toBe(listingKey("6755 N Hermitage Ave", "1"));
  });
});
