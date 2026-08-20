import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  validateMimeType,
  validateFileSize,
  isAllowedMimeType,
  getMimeCategory,
  getMaxFileSize,
  buildPhotoPath,
  buildLeaseDocPath,
  buildNoticeProofPath,
  buildReceiptPath,
  createStorageClient,
  generateUploadUrl,
  generateDownloadUrl,
  fileExists,
  deleteFile,
  UPLOAD_URL_TTL,
  DOWNLOAD_URL_TTL,
  MAX_FILE_SIZES,
  type StorageConfig,
} from "../storage.js";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";

// ── MIME Type Validation ──

describe("MIME type validation", () => {
  it("allows image/jpeg", () => {
    expect(isAllowedMimeType("image/jpeg")).toBe(true);
  });

  it("allows image/png", () => {
    expect(isAllowedMimeType("image/png")).toBe(true);
  });

  it("allows image/webp", () => {
    expect(isAllowedMimeType("image/webp")).toBe(true);
  });

  it("allows application/pdf", () => {
    expect(isAllowedMimeType("application/pdf")).toBe(true);
  });

  it("rejects image/gif", () => {
    expect(isAllowedMimeType("image/gif")).toBe(false);
  });

  it("rejects text/html", () => {
    expect(isAllowedMimeType("text/html")).toBe(false);
  });

  it("rejects application/javascript", () => {
    expect(isAllowedMimeType("application/javascript")).toBe(false);
  });

  it("getMimeCategory returns correct category for images", () => {
    expect(getMimeCategory("image/jpeg")).toBe("image");
    expect(getMimeCategory("image/png")).toBe("image");
  });

  it("getMimeCategory returns correct category for documents", () => {
    expect(getMimeCategory("application/pdf")).toBe("document");
  });

  it("getMimeCategory returns null for unknown type", () => {
    expect(getMimeCategory("video/mp4")).toBeNull();
  });

  it("getMaxFileSize returns 10MB for images", () => {
    expect(getMaxFileSize("image/jpeg")).toBe(10 * 1024 * 1024);
  });

  it("getMaxFileSize returns 25MB for documents", () => {
    expect(getMaxFileSize("application/pdf")).toBe(25 * 1024 * 1024);
  });

  it("getMaxFileSize returns 0 for unknown type", () => {
    expect(getMaxFileSize("video/mp4")).toBe(0);
  });
});

describe("validateMimeType", () => {
  it("returns valid for allowed type", () => {
    const result = validateMimeType("image/jpeg");
    expect(result.valid).toBe(true);
    expect(result.category).toBe("image");
    expect(result.maxSize).toBe(MAX_FILE_SIZES.image);
  });

  it("returns error for disallowed type", () => {
    const result = validateMimeType("video/mp4");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("not allowed");
    expect(result.error).toContain("video/mp4");
  });
});

describe("validateFileSize", () => {
  it("accepts file within image size limit", () => {
    const result = validateFileSize(5 * 1024 * 1024, "image/jpeg"); // 5MB
    expect(result.valid).toBe(true);
  });

  it("rejects image file exceeding 10MB", () => {
    const result = validateFileSize(11 * 1024 * 1024, "image/jpeg"); // 11MB
    expect(result.valid).toBe(false);
    expect(result.error).toContain("exceeds maximum");
    expect(result.error).toContain("10MB");
  });

  it("accepts PDF within 25MB limit", () => {
    const result = validateFileSize(20 * 1024 * 1024, "application/pdf");
    expect(result.valid).toBe(true);
  });

  it("rejects PDF exceeding 25MB", () => {
    const result = validateFileSize(26 * 1024 * 1024, "application/pdf");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("exceeds maximum");
  });

  it("rejects disallowed MIME type regardless of size", () => {
    const result = validateFileSize(100, "text/html");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("not allowed");
  });
});

// ── Path Builders ──

describe("path builders", () => {
  it("buildPhotoPath follows /{userId}/properties/{propertyId}/photos/ structure", () => {
    const path = buildPhotoPath("user123", "prop456", "photo.jpg");
    expect(path).toBe("user123/properties/prop456/photos/photo.jpg");
  });

  it("buildLeaseDocPath follows /{userId}/leases/{leaseId}/docs/ structure", () => {
    const path = buildLeaseDocPath("user123", "lease789", "lease.pdf");
    expect(path).toBe("user123/leases/lease789/docs/lease.pdf");
  });

  it("buildNoticeProofPath follows /{userId}/notices/{noticeId}/proof/ structure", () => {
    const path = buildNoticeProofPath("user123", "notice001", "proof.jpg");
    expect(path).toBe("user123/notices/notice001/proof/proof.jpg");
  });

  it("buildReceiptPath follows /{userId}/payments/{paymentId}/ structure", () => {
    const path = buildReceiptPath("user123", "pay001", "receipt.pdf");
    expect(path).toBe("user123/payments/pay001/receipt.pdf");
  });
});

// ── TTL Defaults ──

describe("TTL defaults", () => {
  it("upload URL TTL is 15 minutes (900s)", () => {
    expect(UPLOAD_URL_TTL).toBe(900);
  });

  it("download URL TTL is 1 hour (3600s)", () => {
    expect(DOWNLOAD_URL_TTL).toBe(3600);
  });
});

// ── Integration Tests (MinIO) ──

describe("S3 integration (MinIO)", () => {
  const MINIO_CONFIG: StorageConfig = {
    bucket: "tenant-ai-test",
    region: "us-east-1",
    endpoint: "http://localhost:9002",
    accessKeyId: "minioadmin",
    secretAccessKey: "minioadmin",
    forcePathStyle: true,
  };

  let client: S3Client;
  let minioAvailable = false;

  beforeAll(async () => {
    client = createStorageClient(MINIO_CONFIG);

    // Check if MinIO is running
    try {
      const { CreateBucketCommand, HeadBucketCommand } = await import(
        "@aws-sdk/client-s3"
      );
      try {
        await client.send(
          new HeadBucketCommand({ Bucket: MINIO_CONFIG.bucket })
        );
      } catch {
        await client.send(
          new CreateBucketCommand({ Bucket: MINIO_CONFIG.bucket })
        );
      }
      minioAvailable = true;
    } catch {
      console.log("MinIO not available — skipping integration tests");
    }
  });

  afterAll(async () => {
    if (minioAvailable) {
      // Clean up test file
      try {
        await deleteFile(client, MINIO_CONFIG.bucket, "test/integration.txt");
      } catch {
        // ignore
      }
    }
  });

  it("generates pre-signed upload URL", async () => {
    if (!minioAvailable) return;

    const result = await generateUploadUrl(
      client,
      MINIO_CONFIG.bucket,
      "test/upload-test.jpg",
      "image/jpeg"
    );

    expect(result.uploadUrl).toContain("X-Amz-Signature");
    expect(result.key).toBe("test/upload-test.jpg");
    expect(result.expiresIn).toBe(UPLOAD_URL_TTL);
  });

  it("generates pre-signed upload URL with custom TTL", async () => {
    if (!minioAvailable) return;

    const result = await generateUploadUrl(
      client,
      MINIO_CONFIG.bucket,
      "test/upload-ttl.jpg",
      "image/jpeg",
      300 // 5 min
    );

    expect(result.expiresIn).toBe(300);
  });

  it("generates pre-signed download URL", async () => {
    if (!minioAvailable) return;

    // First upload a file directly
    await client.send(
      new PutObjectCommand({
        Bucket: MINIO_CONFIG.bucket,
        Key: "test/integration.txt",
        Body: "hello world",
        ContentType: "text/plain",
      })
    );

    const result = await generateDownloadUrl(
      client,
      MINIO_CONFIG.bucket,
      "test/integration.txt"
    );

    expect(result.downloadUrl).toContain("X-Amz-Signature");
    expect(result.expiresIn).toBe(DOWNLOAD_URL_TTL);
  });

  it("upload via pre-signed URL → file exists at expected path", async () => {
    if (!minioAvailable) return;

    const key = "test/presigned-upload.txt";

    // Get pre-signed upload URL
    const { uploadUrl } = await generateUploadUrl(
      client,
      MINIO_CONFIG.bucket,
      key,
      "text/plain"
    );

    // Upload via the pre-signed URL
    const response = await fetch(uploadUrl, {
      method: "PUT",
      body: "test content via presigned url",
      headers: { "Content-Type": "text/plain" },
    });
    expect(response.ok).toBe(true);

    // Verify file exists
    const exists = await fileExists(client, MINIO_CONFIG.bucket, key);
    expect(exists).toBe(true);

    // Clean up
    await deleteFile(client, MINIO_CONFIG.bucket, key);
  });

  it("fileExists returns false for non-existent key", async () => {
    if (!minioAvailable) return;

    const exists = await fileExists(
      client,
      MINIO_CONFIG.bucket,
      "does/not/exist.txt"
    );
    expect(exists).toBe(false);
  });

  it("deleteFile removes a file", async () => {
    if (!minioAvailable) return;

    const key = "test/to-delete.txt";

    // Upload
    await client.send(
      new PutObjectCommand({
        Bucket: MINIO_CONFIG.bucket,
        Key: key,
        Body: "delete me",
      })
    );

    // Verify exists
    expect(await fileExists(client, MINIO_CONFIG.bucket, key)).toBe(true);

    // Delete
    await deleteFile(client, MINIO_CONFIG.bucket, key);

    // Verify gone
    expect(await fileExists(client, MINIO_CONFIG.bucket, key)).toBe(false);
  });

  it("download URL for non-existent file still generates (access denied on fetch)", async () => {
    if (!minioAvailable) return;

    // Pre-signed URL can be generated for any key — 403 happens on actual fetch
    const result = await generateDownloadUrl(
      client,
      MINIO_CONFIG.bucket,
      "does/not/exist.txt"
    );

    expect(result.downloadUrl).toBeDefined();
    expect(result.downloadUrl).toContain("X-Amz-Signature");

    // Fetching the URL for a non-existent file should fail
    const response = await fetch(result.downloadUrl);
    expect(response.ok).toBe(false);
  });
});
