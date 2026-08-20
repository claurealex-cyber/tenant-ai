import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { tenantAuthOptions } from "@/lib/auth";

/**
 * POST /api/portal/maintenance/upload-url — get a pre-signed S3 upload URL for maintenance photos.
 *
 * Body: { filename: string, contentType: string }
 * Returns: { uploadUrl, key, expiresIn }
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(tenantAuthOptions);
  if (!session?.tenant) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { filename, contentType } = await request.json();

  if (!filename || !contentType) {
    return NextResponse.json(
      { error: "filename and contentType are required" },
      { status: 400 }
    );
  }

  // Validate MIME type
  try {
    const { validateMimeType } = await import("@tenant-ai/shared");
    const validation = validateMimeType(contentType);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    if (validation.category !== "image") {
      return NextResponse.json(
        { error: "Only image files are allowed for maintenance photos" },
        { status: 400 }
      );
    }
  } catch {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(contentType)) {
      return NextResponse.json(
        { error: "Only JPEG, PNG, and WebP images are allowed" },
        { status: 400 }
      );
    }
  }

  // Generate unique filename
  const ext = filename.split(".").pop() || "jpg";
  const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const subFolder = crypto.randomUUID();

  try {
    const {
      createStorageClientFromEnv,
      getBucketFromEnv,
      generateUploadUrl,
    } = await import("@tenant-ai/shared");

    const client = createStorageClientFromEnv();
    const bucket = getBucketFromEnv();
    const key = `maintenance/${session.tenant.id}/${subFolder}/${uniqueName}`;

    const result = await generateUploadUrl(client, bucket, key, contentType);

    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { error: "File storage is not configured" },
      { status: 503 }
    );
  }
}
