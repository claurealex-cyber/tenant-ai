import { describe, it, expect } from "vitest";

/**
 * Tests for money display formatting logic used across tenant-site pages.
 * All monetary values are stored in cents (PostgreSQL integer) and must be
 * converted to dollars for display.
 */

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatRent(min: number | null, max: number | null): string {
  if (min === null && max === null) return "Contact for pricing";
  if (min === max || max === null) return `$${formatCents(min ?? 0)}/mo`;
  if (min === null) return `Up to $${formatCents(max)}/mo`;
  return `$${formatCents(min)} - $${formatCents(max)}/mo`;
}

describe("Money Display - formatCents", () => {
  it("formats 150000 cents as 1,500.00", () => {
    expect(formatCents(150000)).toBe("1,500.00");
  });

  it("formats 0 cents as 0.00", () => {
    expect(formatCents(0)).toBe("0.00");
  });

  it("formats 99 cents as 0.99", () => {
    expect(formatCents(99)).toBe("0.99");
  });

  it("formats 100 cents as 1.00", () => {
    expect(formatCents(100)).toBe("1.00");
  });

  it("formats large amounts correctly", () => {
    expect(formatCents(1000000)).toBe("10,000.00");
  });

  it("formats single cent correctly", () => {
    expect(formatCents(1)).toBe("0.01");
  });
});

describe("Money Display - formatRent", () => {
  it("formats rent range with min and max", () => {
    const result = formatRent(150000, 200000);
    expect(result).toContain("1,500.00");
    expect(result).toContain("2,000.00");
  });

  it("formats null rent as contact for pricing", () => {
    expect(formatRent(null, null)).toBe("Contact for pricing");
  });

  it("formats equal min and max as single price", () => {
    const result = formatRent(150000, 150000);
    expect(result).toBe("$1,500.00/mo");
  });

  it("formats min-only as single price", () => {
    const result = formatRent(150000, null);
    expect(result).toBe("$1,500.00/mo");
  });

  it("formats max-only as up to price", () => {
    const result = formatRent(null, 200000);
    expect(result).toBe("Up to $2,000.00/mo");
  });
});
