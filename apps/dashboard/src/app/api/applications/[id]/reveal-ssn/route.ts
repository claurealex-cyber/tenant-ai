import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@tenant-ai/shared";

/**
 * POST /api/applications/[id]/reveal-ssn — decrypt and return SSN.
 * Logs access in AuditLog.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const application = await prisma.application.findUnique({
    where: { id },
    include: {
      property: { select: { userId: true } },
    },
  });

  if (!application || application.property.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!application.ssn) {
    return NextResponse.json(
      { error: "No SSN on file for this application" },
      { status: 404 },
    );
  }

  // Log the access
  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "ssn_reveal",
      resourceType: "application",
      resourceId: id,
      metadata: {
        applicantName: application.fullName,
        ipAddress: "server-side",
      },
    },
  });

  // Decrypt SSN
  let decryptedSsn: string;
  try {
    decryptedSsn = decrypt(application.ssn);
  } catch {
    return NextResponse.json(
      { error: "Failed to decrypt SSN" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ssn: decryptedSsn });
}
