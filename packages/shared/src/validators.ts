import * as chrono from "chrono-node";
import { parsePhoneNumber, isValidPhoneNumber } from "libphonenumber-js";

import type { ValidationResult } from "./types.js";

// ── SSN ──

const INVALID_SSNS = new Set([
  "000000000",
  "111111111",
  "222222222",
  "333333333",
  "444444444",
  "555555555",
  "666666666",
  "777777777",
  "888888888",
  "999999999",
]);

export function validateSSN(input: string): ValidationResult {
  const digits = input.replace(/\D/g, "");

  if (digits.length !== 9) {
    return { valid: false, error: "SSN must be 9 digits" };
  }

  if (INVALID_SSNS.has(digits)) {
    return { valid: false, error: "That doesn't appear to be a valid SSN" };
  }

  // SSN cannot start with 9 (ITIN range) or 000
  if (digits.startsWith("9") || digits.startsWith("000")) {
    return { valid: false, error: "That doesn't appear to be a valid SSN" };
  }

  // Middle group cannot be 00, last group cannot be 0000
  if (digits.slice(3, 5) === "00" || digits.slice(5) === "0000") {
    return { valid: false, error: "That doesn't appear to be a valid SSN" };
  }

  const formatted = `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
  return { valid: true, value: formatted };
}

// ── Phone ──

export function validatePhone(input: string): ValidationResult {
  try {
    // Try parsing as US number
    if (!isValidPhoneNumber(input, "US")) {
      return { valid: false, error: "Please provide a valid US phone number" };
    }

    const parsed = parsePhoneNumber(input, "US");
    return { valid: true, value: parsed.format("E.164") }; // +1XXXXXXXXXX
  } catch {
    return { valid: false, error: "Please provide a valid US phone number" };
  }
}

// ── Email ──

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(input: string): ValidationResult {
  const trimmed = input.trim().toLowerCase();

  if (!EMAIL_REGEX.test(trimmed)) {
    return { valid: false, error: "Please provide a valid email address" };
  }

  return { valid: true, value: trimmed };
}

// ── Date of Birth ──

export function parseDateOfBirth(input: string): ValidationResult {
  const results = chrono.parse(input, new Date(), { forwardDate: false });

  if (results.length === 0) {
    return {
      valid: false,
      error: "I couldn't understand that date. Please try again (e.g., March 5, 1990)",
    };
  }

  const date = results[0].start.date();
  const now = new Date();

  if (date >= now) {
    return { valid: false, error: "Date of birth must be in the past" };
  }

  // Sanity check: person should be at least ~14 years old for rental application
  const minAge = new Date();
  minAge.setFullYear(minAge.getFullYear() - 14);
  if (date > minAge) {
    return {
      valid: false,
      error: "Applicant must be at least 14 years old",
    };
  }

  // Max ~120 years old
  const maxAge = new Date();
  maxAge.setFullYear(maxAge.getFullYear() - 120);
  if (date < maxAge) {
    return {
      valid: false,
      error: "That date doesn't seem right. Please try again.",
    };
  }

  return { valid: true, value: date.toISOString().split("T")[0] };
}

// ── Move-in Date ──

export function parseMoveInDate(input: string): ValidationResult {
  const results = chrono.parse(input, new Date(), { forwardDate: true });

  if (results.length === 0) {
    return {
      valid: false,
      error: "I couldn't understand that date. Please try again (e.g., next month, April 1)",
    };
  }

  const date = results[0].start.date();
  const now = new Date();

  // Allow today or future
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (date < today) {
    return { valid: false, error: "Move-in date must be in the future" };
  }

  // Sanity: not more than 2 years out
  const maxDate = new Date();
  maxDate.setFullYear(maxDate.getFullYear() + 2);
  if (date > maxDate) {
    return {
      valid: false,
      error: "Move-in date seems too far in the future. Please confirm.",
    };
  }

  return { valid: true, value: date.toISOString().split("T")[0] };
}

// ── Monthly Income ──

export function parseIncome(input: string): ValidationResult {
  let cleaned = input.trim().toLowerCase();

  // Remove common prefixes/suffixes
  cleaned = cleaned.replace(/\$/g, "");
  cleaned = cleaned.replace(/,/g, "");
  cleaned = cleaned.replace(/per\s*(month|mo)/gi, "");
  cleaned = cleaned.replace(/\/\s*(month|mo)/gi, "");
  cleaned = cleaned.replace(/a\s*month/gi, "");
  cleaned = cleaned.replace(/monthly/gi, "");
  cleaned = cleaned.replace(/around|about|approximately|roughly|~|approx/gi, "");
  cleaned = cleaned.trim();

  // Handle "k" suffix: "5k" → "5000", "5.5k" → "5500"
  const kMatch = cleaned.match(/^(\d+\.?\d*)\s*k$/i);
  if (kMatch) {
    const value = Math.round(parseFloat(kMatch[1]) * 1000);
    return { valid: true, value: String(value) };
  }

  // Try to extract a number
  const numMatch = cleaned.match(/(\d+\.?\d*)/);
  if (!numMatch) {
    return {
      valid: false,
      error: "I couldn't understand the income amount. Please provide a number (e.g., $5,000 or 5k)",
    };
  }

  const value = Math.round(parseFloat(numMatch[1]));

  if (value <= 0) {
    return { valid: false, error: "Income must be a positive number" };
  }

  // Sanity check: if very small, might be hourly rate
  if (value < 100) {
    return {
      valid: false,
      error: "That seems low for monthly income. Did you mean per hour? Please provide your monthly income.",
    };
  }

  // Upper bound: $1M/month is unreasonably high for a rental application
  if (value > 1_000_000) {
    return {
      valid: false,
      error: "That amount seems too high. Please provide your monthly income.",
    };
  }

  return { valid: true, value: String(value) };
}
