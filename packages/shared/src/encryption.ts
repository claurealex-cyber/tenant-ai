import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const CURRENT_VERSION = "v1";

function getKey(version: string): Buffer {
  const envMap: Record<string, string> = {
    v1: "PII_ENCRYPTION_KEY",
    v2: "PII_ENCRYPTION_KEY_V2",
  };

  const envVar = envMap[version];
  if (!envVar) {
    throw new Error(`Unknown encryption key version: ${version}`);
  }

  const hex = process.env[envVar];
  if (!hex) {
    throw new Error(
      `Encryption key not set: ${envVar} environment variable is missing`
    );
  }

  if (hex.length !== 64) {
    throw new Error(
      `${envVar} must be a 64-character hex string (32 bytes). Got ${hex.length} characters.`
    );
  }

  return Buffer.from(hex, "hex");
}

/**
 * Encrypt plaintext using AES-256-GCM.
 * Output format: `v1:<base64(iv + ciphertext + authTag)>`
 */
export function encrypt(plaintext: string): string {
  const key = getKey(CURRENT_VERSION);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  const payload = Buffer.concat([iv, encrypted, authTag]);
  return `${CURRENT_VERSION}:${payload.toString("base64")}`;
}

/**
 * Decrypt ciphertext produced by `encrypt()`.
 * Supports key rotation: tries the version prefix's key first.
 */
export function decrypt(ciphertext: string): string {
  const colonIdx = ciphertext.indexOf(":");
  if (colonIdx === -1) {
    throw new Error("Invalid ciphertext format: missing version prefix");
  }

  const version = ciphertext.slice(0, colonIdx);
  const base64Payload = ciphertext.slice(colonIdx + 1);

  const key = getKey(version);
  const payload = Buffer.from(base64Payload, "base64");

  if (payload.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Invalid ciphertext: payload too short");
  }

  const iv = payload.subarray(0, IV_LENGTH);
  const authTag = payload.subarray(payload.length - AUTH_TAG_LENGTH);
  const encrypted = payload.subarray(IV_LENGTH, payload.length - AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

/**
 * Re-encrypt a ciphertext from its current version to the current version.
 * Used during key rotation to migrate old data.
 */
export function reEncrypt(ciphertext: string): string {
  const colonIdx = ciphertext.indexOf(":");
  if (colonIdx === -1) {
    throw new Error("Invalid ciphertext format: missing version prefix");
  }

  const version = ciphertext.slice(0, colonIdx);
  if (version === CURRENT_VERSION) {
    return ciphertext; // Already on current version
  }

  const plaintext = decrypt(ciphertext);
  return encrypt(plaintext);
}

/**
 * Get the key version from a ciphertext string.
 */
export function getKeyVersion(ciphertext: string): string {
  const colonIdx = ciphertext.indexOf(":");
  if (colonIdx === -1) {
    throw new Error("Invalid ciphertext format: missing version prefix");
  }
  return ciphertext.slice(0, colonIdx);
}
