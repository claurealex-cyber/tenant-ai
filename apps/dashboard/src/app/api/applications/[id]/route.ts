import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@tenant-ai/shared";

function maskSSN(ssn: string | null): string | null {
  if (!ssn) return null;
  // Return masked: •••-••-XXXX (last 4 digits)
  // SSN is encrypted, so we can't easily get last 4 without decrypting
  // For the list/detail view, just indicate it's present
  return "•••-••-••••";
}

/**
 * GET /api/applications/[id] — get application detail.
 * SSN is masked by default; use /reveal-ssn endpoint to decrypt.
 */
export async function GET(
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
      property: { select: { id: true, name: true, userId: true } },
      callLog: {
        select: {
          id: true,
          transcript: true,
          duration: true,
          channel: true,
          startedAt: true,
          endedAt: true,
        },
      },
    },
  });

  if (!application || application.property.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Mask SSN in response
  const result = {
    ...application,
    ssn: application.ssn ? maskSSN(application.ssn) : null,
    ssnPresent: !!application.ssn,
  };

  return NextResponse.json({ application: result });
}

/**
 * PUT /api/applications/[id] — update application (status, review notes).
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
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

    const body = await request.json();
    const { status, reviewNotes } = body;

    const validStatuses = ["in_progress", "completed", "reviewed", "rejected"];
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` },
        { status: 400 },
      );
    }

    // Enforce valid status transitions
    const ALLOWED_TRANSITIONS: Record<string, string[]> = {
      in_progress: ["completed"],
      completed: ["reviewed", "rejected"],
      reviewed: ["rejected"],
      rejected: ["reviewed"],
    };

    if (status && application.status !== status) {
      const allowed = ALLOWED_TRANSITIONS[application.status] || [];
      if (!allowed.includes(status)) {
        return NextResponse.json(
          { error: `Cannot change status from "${application.status}" to "${status}"` },
          { status: 400 },
        );
      }
    }

    const data: Record<string, unknown> = {};

    if (status) {
      data.status = status;
      if (status === "reviewed" || status === "rejected") {
        data.reviewedAt = new Date();
      }
    }

    if (reviewNotes !== undefined) {
      data.reviewNotes = reviewNotes;
    }

    const updated = await prisma.application.update({
      where: { id },
      data,
    });

    if (status) {
      await logAudit(prisma, {
        userId: session.user.id,
        action: "update_application_status",
        resourceType: "Application",
        resourceId: id,
        metadata: { fromStatus: application.status, toStatus: status } as any,
      });
    }

    return NextResponse.json({ application: updated });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
