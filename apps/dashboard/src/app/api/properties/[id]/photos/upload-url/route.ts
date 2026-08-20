import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/properties/[id]/photos/upload-url — get a pre-signed S3 upload URL.
 *
 * Body: { filename: string, contentType: string }
 * Returns: { uploadUrl, key, expiresIn }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const property = await prisma.property.findFirst({
    where: { id: params.id, userId: session.user.id },
  });

  if (!property) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
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
        { error: "Only image files are allowed for property photos" },
        { status: 400 }
      );
    }
  } catch {
    // If shared package unavailable, allow common image types
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

  try {
    const {
      createStorageClientFromEnv,
      getBucketFromEnv,
      buildPhotoPath,
      generateUploadUrl,
    } = await import("@tenant-ai/shared");

    const client = createStorageClientFromEnv();
    const bucket = getBucketFromEnv();
    const key = buildPhotoPath(session.user.id, params.id, uniqueName);

    const result = await generateUploadUrl(client, bucket, key, contentType);

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: "File storage is not configured" },
      { status: 503 }
    );
  }
}
