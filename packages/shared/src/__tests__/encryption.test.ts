import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encrypt, decrypt, reEncrypt, getKeyVersion } from "../encryption.js";

// 32-byte hex keys for testing
const TEST_KEY_V1 = "a".repeat(64);
const TEST_KEY_V2 = "b".repeat(64);

describe("PII Encryption (AES-256-GCM)", () => {
  beforeEach(() => {
    process.env.PII_ENCRYPTION_KEY = TEST_KEY_V1;
    delete process.env.PII_ENCRYPTION_KEY_V2;
  });

  afterEach(() => {
    delete process.env.PII_ENCRYPTION_KEY;
    delete process.env.PII_ENCRYPTION_KEY_V2;
  });

  it("encrypts and returns base64 ciphertext with version prefix", () => {
    const ciphertext = encrypt("123-45-6789");
    expect(ciphertext).toMatch(/^v1:/);
    expect(ciphertext.length).toBeGreaterThan(5);
  });

  it("produces different ciphertext each time (random IV)", () => {
    const a = encrypt("123-45-6789");
    const b = encrypt("123-45-6789");
    expect(a).not.toBe(b);
  });

  it("decrypts back to original plaintext", () => {
    const ciphertext = encrypt("123-45-6789");
    const plaintext = decrypt(ciphertext);
    expect(plaintext).toBe("123-45-6789");
  });

  it("handles empty string", () => {
    const ciphertext = encrypt("");
    expect(decrypt(ciphertext)).toBe("");
  });

  it("handles unicode characters", () => {
    const ciphertext = encrypt("José García 日本語");
    expect(decrypt(ciphertext)).toBe("José García 日本語");
  });

  it("throws on invalid key (wrong env var)", () => {
    delete process.env.PII_ENCRYPTION_KEY;
    expect(() => encrypt("test")).toThrow("Encryption key not set");
  });

  it("throws on key with wrong length", () => {
    process.env.PII_ENCRYPTION_KEY = "tooshort";
    expect(() => encrypt("test")).toThrow("must be a 64-character hex string");
  });

  it("throws on tampered ciphertext (GCM auth tag verification)", () => {
    const ciphertext = encrypt("123-45-6789");
    // Flip a character in the base64 payload
    const parts = ciphertext.split(":");
    const tampered =
      parts[0] +
      ":" +
      parts[1].slice(0, -2) +
      (parts[1].slice(-2) === "AA" ? "BB" : "AA");
    expect(() => decrypt(tampered)).toThrow();
  });

  it("throws on missing version prefix", () => {
    expect(() => decrypt("nocolonhere")).toThrow("missing version prefix");
  });

  it("throws on unknown version", () => {
    expect(() => decrypt("v99:AAAA")).toThrow("Unknown encryption key version");
  });

  it("getKeyVersion extracts version correctly", () => {
    const ciphertext = encrypt("test");
    expect(getKeyVersion(ciphertext)).toBe("v1");
  });

  describe("key rotation", () => {
    it("data encrypted with v1 key can be decrypted during rotation period", () => {
      // Encrypt with v1
      const ciphertext = encrypt("sensitive-data");

      // Set up v2 key (rotation period: both keys available)
      process.env.PII_ENCRYPTION_KEY_V2 = TEST_KEY_V2;

      // v1 ciphertext still decryptable
      expect(decrypt(ciphertext)).toBe("sensitive-data");
    });

    it("reEncrypt migrates from v1 to current version", () => {
      // Encrypt with v1
      const v1Ciphertext = encrypt("sensitive-data");
      expect(getKeyVersion(v1Ciphertext)).toBe("v1");

      // Re-encrypting v1 data returns same v1 (since CURRENT_VERSION is v1)
      const result = reEncrypt(v1Ciphertext);
      expect(decrypt(result)).toBe("sensitive-data");
    });

    it("reEncrypt is a no-op when already on current version", () => {
      const ciphertext = encrypt("test");
      const result = reEncrypt(ciphertext);
      // Should still be decryptable
      expect(decrypt(result)).toBe("test");
    });
  });
});
