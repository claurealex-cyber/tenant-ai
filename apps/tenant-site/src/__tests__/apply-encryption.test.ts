/**
 * Tests for PII encryption in the apply route.
 *
 * The apply route (apps/tenant-site/src/app/api/apply/route.ts) encrypts SSN
 * and DOB before storing them. Since the route uses @/lib/prisma and
 * @/lib/tenant-context (resolved via Next.js tsconfig, not the root vitest
 * alias), we test the encryption logic directly by replicating the route's
 * encryption flow and verifying encrypt/decrypt round-trips.
 *
 * This tests the same code path the route uses:
 *   const encryptedSsn = ssn ? encrypt(ssn) : undefined;
 *   const encryptedDob = dateOfBirth ? encrypt(dateOfBirth) : undefined;
 */

// Set encryption key BEFORE any imports that use it
process.env.PII_ENCRYPTION_KEY =
  "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2";

import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "@tenant-ai/shared";

/**
 * Replicates the exact encryption logic from the apply route handler.
 * See apps/tenant-site/src/app/api/apply/route.ts lines 82-87.
 */
function encryptPiiFields(standardData: Record<string, unknown>) {
  const encryptedSsn = standardData.ssn
    ? encrypt(standardData.ssn as string)
    : undefined;
  const encryptedDob = standardData.dateOfBirth
    ? encrypt(standardData.dateOfBirth as string)
    : undefined;

  return { encryptedSsn, encryptedDob };
}

/**
 * Replicates the field separation logic from the apply route handler.
 * See apps/tenant-site/src/app/api/apply/route.ts lines 65-79.
 */
function separateFields(fields: Record<string, unknown>) {
  const standardFields = [
    "fullName", "dateOfBirth", "ssn", "email", "currentAddress",
    "monthlyIncome", "employer", "employerPhone", "moveInDate",
    "hasPets", "petDetails",
  ];
  const standardData: Record<string, unknown> = {};
  const customResponses: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (standardFields.includes(key)) {
      standardData[key] = value;
    } else {
      customResponses[key] = value;
    }
  }

  return { standardData, customResponses };
}

describe("Apply Route - SSN/DOB Encryption", () => {
  it("encrypts SSN before storing", () => {
    const { standardData } = separateFields({
      fullName: "John Doe",
      ssn: "123-45-6789",
      email: "john@test.com",
    });

    const { encryptedSsn } = encryptPiiFields(standardData);

    // SSN should be encrypted, not plaintext
    expect(encryptedSsn).not.toBe("123-45-6789");
    expect(encryptedSsn).toMatch(/^v1:/); // Encrypted format prefix
    // Should be decryptable back to original
    expect(decrypt(encryptedSsn!)).toBe("123-45-6789");
  });

  it("encrypts DOB before storing", () => {
    const { standardData } = separateFields({
      fullName: "John Doe",
      dateOfBirth: "1990-03-05",
      email: "john@test.com",
    });

    const { encryptedDob } = encryptPiiFields(standardData);

    expect(encryptedDob).not.toBe("1990-03-05");
    expect(encryptedDob).toMatch(/^v1:/);
    expect(decrypt(encryptedDob!)).toBe("1990-03-05");
  });

  it("handles missing SSN gracefully", () => {
    const { standardData } = separateFields({
      fullName: "John Doe",
      email: "john@test.com",
    });

    const { encryptedSsn } = encryptPiiFields(standardData);

    expect(encryptedSsn).toBeUndefined();
  });

  it("handles missing DOB gracefully", () => {
    const { standardData } = separateFields({
      fullName: "John Doe",
      email: "john@test.com",
    });

    const { encryptedDob } = encryptPiiFields(standardData);

    expect(encryptedDob).toBeUndefined();
  });

  it("encrypts both SSN and DOB when both provided", () => {
    const { standardData } = separateFields({
      fullName: "Jane Smith",
      ssn: "987-65-4321",
      dateOfBirth: "1985-12-25",
      email: "jane@test.com",
    });

    const { encryptedSsn, encryptedDob } = encryptPiiFields(standardData);

    expect(decrypt(encryptedSsn!)).toBe("987-65-4321");
    expect(decrypt(encryptedDob!)).toBe("1985-12-25");
  });

  it("does not encrypt non-PII standard fields", () => {
    const { standardData } = separateFields({
      fullName: "Jane Smith",
      ssn: "987-65-4321",
      dateOfBirth: "1985-12-25",
      email: "jane@test.com",
      employer: "Tech Corp",
    });

    // Non-PII fields remain in plaintext in standardData
    expect(standardData.fullName).toBe("Jane Smith");
    expect(standardData.email).toBe("jane@test.com");
    expect(standardData.employer).toBe("Tech Corp");
  });

  it("separates custom responses from standard fields", () => {
    const { standardData, customResponses } = separateFields({
      fullName: "Jane Smith",
      ssn: "987-65-4321",
      email: "jane@test.com",
      felonies: "no",
      smoker: "no",
    });

    // Standard fields should be in standardData
    expect(standardData.fullName).toBe("Jane Smith");
    expect(standardData.ssn).toBe("987-65-4321");
    expect(standardData.email).toBe("jane@test.com");

    // Custom fields should be in customResponses
    expect(customResponses.felonies).toBe("no");
    expect(customResponses.smoker).toBe("no");

    // Custom fields should NOT be in standardData
    expect(standardData.felonies).toBeUndefined();
    expect(standardData.smoker).toBeUndefined();
  });

  it("produces unique ciphertexts for the same plaintext", () => {
    // AES-256-GCM uses random IVs, so encrypting the same value twice
    // should produce different ciphertexts
    const ssn = "123-45-6789";
    const encrypted1 = encrypt(ssn);
    const encrypted2 = encrypt(ssn);

    expect(encrypted1).not.toBe(encrypted2);
    expect(decrypt(encrypted1)).toBe(ssn);
    expect(decrypt(encrypted2)).toBe(ssn);
  });

  it("encrypted values use the v1 key version prefix", () => {
    const encrypted = encrypt("test-value");
    expect(encrypted.startsWith("v1:")).toBe(true);
  });
});
