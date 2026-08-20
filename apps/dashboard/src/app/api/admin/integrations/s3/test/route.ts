import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveIntegration, createStorageClient } from "@tenant-ai/shared";
import { HeadBucketCommand } from "@aws-sdk/client-s3";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const config = await resolveIntegration("s3");
    if (!config.access_key_id || !config.secret_access_key || !config.bucket) {
      return NextResponse.json({ connected: false, message: "Access Key, Secret Key, and Bucket are required" });
    }

    const client = createStorageClient({
      bucket: config.bucket!,
      region: config.region || "us-east-1",
      endpoint: config.endpoint || undefined,
      accessKeyId: config.access_key_id!,
      secretAccessKey: config.secret_access_key!,
    });

    await client.send(new HeadBucketCommand({ Bucket: config.bucket! }));
    return NextResponse.json({ connected: true, message: `Connected to bucket: ${config.bucket}` });
  } catch (error: any) {
    return NextResponse.json({ connected: false, message: error.message || "Connection failed" });
  }
}
