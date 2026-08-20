import { describe, it, expect } from "vitest";
import {
  validateSSN,
  validatePhone,
  validateEmail,
  parseDateOfBirth,
  parseMoveInDate,
  parseIncome,
} from "../validators.js";

describe("validateSSN", () => {
  it('validates formatted SSN "123-45-6789"', () => {
    const result = validateSSN("123-45-6789");
    expect(result.valid).toBe(true);
    expect(result.value).toBe("123-45-6789");
  });

  it('validates unformatted SSN "123456789" and auto-formats', () => {
    const result = validateSSN("123456789");
    expect(result.valid).toBe(true);
    expect(result.value).toBe("123-45-6789");
  });

  it("rejects SSN with too few digits", () => {
    const result = validateSSN("12345");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("9 digits");
  });

  it("rejects all-zeros SSN (000-00-0000)", () => {
    const result = validateSSN("000-00-0000");
    expect(result.valid).toBe(false);
  });

  it("rejects SSN starting with 9 (ITIN range)", () => {
    const result = validateSSN("900-12-3456");
    expect(result.valid).toBe(false);
  });

  it("rejects SSN starting with 000", () => {
    const result = validateSSN("000-12-3456");
    expect(result.valid).toBe(false);
  });

  it("rejects SSN with 00 middle group", () => {
    const result = validateSSN("123-00-6789");
    expect(result.valid).toBe(false);
  });

  it("rejects SSN with 0000 last group", () => {
    const result = validateSSN("123-45-0000");
    expect(result.valid).toBe(false);
  });

  it("strips non-digit characters before validation", () => {
    const result = validateSSN("  123 45 6789  ");
    expect(result.valid).toBe(true);
    expect(result.value).toBe("123-45-6789");
  });
});

describe("validatePhone", () => {
  it('validates "(555) 123-4567" and formats to E.164', () => {
    const result = validatePhone("(312) 555-1234");
    expect(result.valid).toBe(true);
    expect(result.value).toBe("+13125551234");
  });

  it("validates 10-digit number", () => {
    const result = validatePhone("3125551234");
    expect(result.valid).toBe(true);
    expect(result.value).toBe("+13125551234");
  });

  it("validates number with +1 prefix", () => {
    const result = validatePhone("+13125551234");
    expect(result.valid).toBe(true);
    expect(result.value).toBe("+13125551234");
  });

  it("rejects short number", () => {
    const result = validatePhone("555-1234");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("valid US phone number");
  });

  it("rejects empty string", () => {
    const result = validatePhone("");
    expect(result.valid).toBe(false);
  });
});

describe("validateEmail", () => {
  it("validates standard email", () => {
    const result = validateEmail("test@example.com");
    expect(result.valid).toBe(true);
    expect(result.value).toBe("test@example.com");
  });

  it("lowercases email", () => {
    const result = validateEmail("Test@Example.COM");
    expect(result.valid).toBe(true);
    expect(result.value).toBe("test@example.com");
  });

  it("trims whitespace", () => {
    const result = validateEmail("  test@example.com  ");
    expect(result.valid).toBe(true);
    expect(result.value).toBe("test@example.com");
  });

  it("rejects invalid email", () => {
    const result = validateEmail("notanemail");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("valid email");
  });

  it("rejects email without domain", () => {
    const result = validateEmail("test@");
    expect(result.valid).toBe(false);
  });
});

describe("parseDateOfBirth", () => {
  it('parses "march 5th 1990"', () => {
    const result = parseDateOfBirth("march 5th 1990");
    expect(result.valid).toBe(true);
    expect(result.value).toBe("1990-03-05");
  });

  it('parses "03/05/1990"', () => {
    const result = parseDateOfBirth("03/05/1990");
    expect(result.valid).toBe(true);
    expect(result.value).toBe("1990-03-05");
  });

  it('parses "1990-03-05"', () => {
    const result = parseDateOfBirth("1990-03-05");
    expect(result.valid).toBe(true);
    expect(result.value).toBe("1990-03-05");
  });

  it('rejects "tomorrow" (future date)', () => {
    const result = parseDateOfBirth("tomorrow");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("past");
  });

  it("rejects unparseable input", () => {
    const result = parseDateOfBirth("not a date at all");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("couldn't understand");
  });
});

describe("parseMoveInDate", () => {
  it('parses "next month" to a future date', () => {
    const result = parseMoveInDate("next month");
    expect(result.valid).toBe(true);
    expect(result.value).toBeDefined();
    // Should be in the future
    const parsed = new Date(result.value!);
    expect(parsed.getTime()).toBeGreaterThan(Date.now() - 86400000); // Allow 1 day tolerance
  });

  it('rejects "last year" (past date)', () => {
    const result = parseMoveInDate("january 1st 2020");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("future");
  });

  it("rejects unparseable input", () => {
    const result = parseMoveInDate("asdfgh");
    expect(result.valid).toBe(false);
  });
});

describe("parseIncome", () => {
  it('parses "about 5k" to "5000"', () => {
    const result = parseIncome("about 5k");
    expect(result.valid).toBe(true);
    expect(result.value).toBe("5000");
  });

  it('parses "$3,500/month" to "3500"', () => {
    const result = parseIncome("$3,500/month");
    expect(result.valid).toBe(true);
    expect(result.value).toBe("3500");
  });

  it('parses "5.5k" to "5500"', () => {
    const result = parseIncome("5.5k");
    expect(result.valid).toBe(true);
    expect(result.value).toBe("5500");
  });

  it('parses "around $4000" to "4000"', () => {
    const result = parseIncome("around $4000");
    expect(result.valid).toBe(true);
    expect(result.value).toBe("4000");
  });

  it('parses "4500 a month" to "4500"', () => {
    const result = parseIncome("4500 a month");
    expect(result.valid).toBe(true);
    expect(result.value).toBe("4500");
  });

  it("rejects non-numeric input", () => {
    const result = parseIncome("no money");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("couldn't understand");
  });

  it("rejects very low numbers (likely hourly rate)", () => {
    const result = parseIncome("25");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("per hour");
  });
});
