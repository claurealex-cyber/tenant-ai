import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// ── Configuration ──

export interface StorageConfig {
  bucket: string;
  region: string;
  endpoint?: string; // MinIO / S3-compatible endpoint
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean; // true for MinIO
}

/** Default TTLs in seconds */
export const UPLOAD_URL_TTL = 900; // 15 minutes
export const DOWNLOAD_URL_TTL = 3600; // 1 hour

/** Maximum file sizes in bytes */
export const MAX_FILE_SIZES: Record<string, number> = {
  image: 10 * 1024 * 1024, // 10 MB
  document: 25 * 1024 * 1024, // 25 MB
};

/** Allowed MIME types grouped by category */
export const ALLOWED_MIME_TYPES: Record<string, string[]> = {
  image: ["image/jpeg", "image/png", "image/webp"],
  document: ["application/pdf"],
};

/** All allowed MIME types as a flat set */
const ALL_ALLOWED_MIMES = new Set(
  Object.values(ALLOWED_MIME_TYPES).flat()
);

// ── MIME Validation ──

export function getMimeCategory(mimeType: string): string | null {
  for (const [category, mimes] of Object.entries(ALLOWED_MIME_TYPES)) {
    if (mimes.includes(mimeType)) return category;
  }
  return null;
}

export function isAllowedMimeType(mimeType: string): boolean {
  return ALL_ALLOWED_MIMES.has(mimeType);
}

export function getMaxFileSize(mimeType: string): number {
  const category = getMimeCategory(mimeType);
  if (!category) return 0;
  return MAX_FILE_SIZES[category] ?? 0;
}

export interface MimeValidationResult {
  valid: boolean;
  error?: string;
  category?: string;
  maxSize?: number;
}

export function validateMimeType(mimeType: string): MimeValidationResult {
  if (!isAllowedMimeType(mimeType)) {
    const allowed = Object.values(ALLOWED_MIME_TYPES).flat().join(", ");
    return {
      valid: false,
      error: `File type "${mimeType}" is not allowed. Allowed types: ${allowed}`,
    };
  }

  const category = getMimeCategory(mimeType)!;
  return {
    valid: true,
    category,
    maxSize: MAX_FILE_SIZES[category],
  };
}

export function validateFileSize(
  sizeBytes: number,
  mimeType: string
): MimeValidationResult {
  const mimeResult = validateMimeType(mimeType);
  if (!mimeResult.valid) return mimeResult;

  const maxSize = mimeResult.maxSize!;
  if (sizeBytes > maxSize) {
    const maxMB = Math.round(maxSize / (1024 * 1024));
    return {
      valid: false,
      error: `File size ${Math.round(sizeBytes / (1024 * 1024))}MB exceeds maximum ${maxMB}MB for ${mimeResult.category} files`,
    };
  }

  return mimeResult;
}

// ── Path Builders ──

export function buildPhotoPath(
  userId: string,
  propertyId: string,
  filename: string
): string {
  return `${userId}/properties/${propertyId}/photos/${filename}`;
}

export function buildLeaseDocPath(
  userId: string,
  leaseId: string,
  filename: string
): string {
  return `${userId}/leases/${leaseId}/docs/${filename}`;
}

export function buildNoticeProofPath(
  userId: string,
  noticeId: string,
  filename: string
): string {
  return `${userId}/notices/${noticeId}/proof/${filename}`;
}

export function buildNoticeSmsPath(
  userId: string,
  noticeId: string,
  filename: string
): string {
  return `${userId}/notices/${noticeId}/sms/${filename}`;
}

export function buildReceiptPath(
  userId: string,
  paymentId: string,
  filename: string
): string {
  return `${userId}/payments/${paymentId}/${filename}`;
}

// ── S3 Client Factory ──

export function createStorageClient(config: StorageConfig): S3Client {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: config.forcePathStyle ?? !!config.endpoint, // auto-enable for custom endpoints (MinIO)
  });
}

export function createStorageClientFromEnv(): S3Client {
  return createStorageClient({
    bucket: process.env.S3_BUCKET || "tenant-ai-uploads",
    region: process.env.S3_REGION || "us-east-1",
    endpoint: process.env.S3_ENDPOINT,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
  });
}

export function getBucketFromEnv(): string {
  return process.env.S3_BUCKET || "tenant-ai-uploads";
}

export async function createStorageClientFromConfig(): Promise<S3Client> {
  const { resolveConfig } = await import("./config-resolver.js");
  return createStorageClient({
    bucket: (await resolveConfig("s3", "bucket", "tenant-ai-uploads")) ?? "tenant-ai-uploads",
    region: (await resolveConfig("s3", "region", "us-east-1")) ?? "us-east-1",
    endpoint: (await resolveConfig("s3", "endpoint")) ?? undefined,
    accessKeyId: (await resolveConfig("s3", "access_key_id")) ?? "",
    secretAccessKey: (await resolveConfig("s3", "secret_access_key")) ?? "",
  });
}

export async function getBucketFromConfig(): Promise<string> {
  const { resolveConfig } = await import("./config-resolver.js");
  return (await resolveConfig("s3", "bucket", "tenant-ai-uploads")) ?? "tenant-ai-uploads";
}

// ── Pre-signed URLs ──

export interface PresignedUploadResult {
  uploadUrl: string;
  key: string;
  expiresIn: number;
}

/**
 * Generate a pre-signed URL for uploading a file to S3.
 *
 * @param client S3 client
 * @param bucket Bucket name
 * @param key Object key (path within bucket)
 * @param contentType MIME type of the file
 * @param expiresIn TTL in seconds (default 15 minutes)
 */
export async function generateUploadUrl(
  client: S3Client,
  bucket: string,
  key: string,
  contentType: string,
  expiresIn: number = UPLOAD_URL_TTL
): Promise<PresignedUploadResult> {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(client, command, { expiresIn });

  return { uploadUrl, key, expiresIn };
}

export interface PresignedDownloadResult {
  downloadUrl: string;
  expiresIn: number;
}

/**
 * Generate a pre-signed URL for downloading a private file from S3.
 *
 * @param client S3 client
 * @param bucket Bucket name
 * @param key Object key (path within bucket)
 * @param expiresIn TTL in seconds (default 1 hour)
 */
export async function generateDownloadUrl(
  client: S3Client,
  bucket: string,
  key: string,
  expiresIn: number = DOWNLOAD_URL_TTL
): Promise<PresignedDownloadResult> {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  const downloadUrl = await getSignedUrl(client, command, { expiresIn });

  return { downloadUrl, expiresIn };
}

// ── File Operations ──

/**
 * Check if a file exists in S3.
 */
export async function fileExists(
  client: S3Client,
  bucket: string,
  key: string
): Promise<boolean> {
  try {
    await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key })
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Upload a file directly to S3.
 */
export async function uploadFile(
  client: S3Client,
  bucket: string,
  key: string,
  body: Buffer | Uint8Array,
  contentType: string
): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

/**
 * Delete a file from S3.
 */
export async function deleteFile(
  client: S3Client,
  bucket: string,
  key: string
): Promise<void> {
  await client.send(
    new DeleteObjectCommand({ Bucket: bucket, Key: key })
  );
}
