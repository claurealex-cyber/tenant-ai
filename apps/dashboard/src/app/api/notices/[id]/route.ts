import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NOTICE_PERIODS } from "@tenant-ai/shared";

/**
 * GET /api/notices/[id] — get a single notice detail.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const notice = await prisma.notice.findUnique({
      where: { id },
      include: {
        tenant: { select: { firstName: true, lastName: true, email: true, phone: true } },
        lease: {
          include: {
            unit: {
              include: {
                property: { select: { id: true, name: true, address: true, userId: true } },
              },
            },
          },
        },
      },
    });

    if (!notice || notice.lease.unit.property.userId !== session.user.id) {
      return NextResponse.json({ error: "Notice not found" }, { status: 404 });
    }

    return NextResponse.json({
      notice: { ...notice, pdfUrl: `/api/notices/${notice.id}/pdf` },
    });
  } catch (err) {
    console.error("[notices] GET detail error:", err);
    return NextResponse.json({ error: "Failed to load notice" }, { status: 500 });
  }
}

/**
 * PUT /api/notices/[id] — update service tracking.
 *
 * Body: { serviceMethod, serviceDate, servedBy, certifiedMailTracking?, serviceProofUrl? }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const notice = await prisma.notice.findUnique({
      where: { id },
      include: {
        lease: {
          include: {
            unit: {
              include: {
                property: { select: { userId: true } },
              },
            },
          },
        },
      },
    });

    if (!notice || notice.lease.unit.property.userId !== session.user.id) {
      return NextResponse.json({ error: "Notice not found" }, { status: 404 });
    }

    const body = await request.json();

    // Mode 1: Content-only update
    if (body.content !== undefined && !body.serviceMethod) {
      const updated = await prisma.notice.update({
        where: { id },
        data: { content: body.content },
      });
      return NextResponse.json({ notice: updated });
    }

    // Mode 2: Service tracking update
    const { serviceMethod, serviceDate, servedBy, certifiedMailTracking, serviceProofUrl } = body;

    // Validate service method
    const validMethods = ["personal", "substitute", "certified_mail"];
    if (!serviceMethod || !validMethods.includes(serviceMethod)) {
      return NextResponse.json(
        { error: "serviceMethod must be: personal, substitute, or certified_mail" },
        { status: 400 }
      );
    }

    if (!serviceDate) {
      return NextResponse.json(
        { error: "serviceDate is required" },
        { status: 400 }
      );
    }

    if (!servedBy?.trim()) {
      return NextResponse.json(
        { error: "servedBy is required" },
        { status: 400 }
      );
    }

    if (serviceMethod === "certified_mail" && !certifiedMailTracking?.trim()) {
      return NextResponse.json(
        { error: "certifiedMailTracking is required for certified mail service" },
        { status: 400 }
      );
    }

    // Calculate effective date
    const svcDate = new Date(serviceDate);
    const effectiveDate = new Date(svcDate);
    if (serviceMethod === "certified_mail") {
      effectiveDate.setDate(effectiveDate.getDate() + 5); // estimated delivery
    }

    // Calculate expiration date
    const period =
      NOTICE_PERIODS[notice.type as keyof typeof NOTICE_PERIODS] ?? 5;
    const expirationDate = new Date(effectiveDate);
    expirationDate.setDate(expirationDate.getDate() + period);

    const updated = await prisma.notice.update({
      where: { id },
      data: {
        serviceMethod,
        serviceDate: svcDate,
        servedBy,
        certifiedMailTracking: certifiedMailTracking || null,
        serviceProofUrl: serviceProofUrl || null,
        serviceConfirmed: true,
        effectiveDate,
        expirationDate,
      },
    });

    return NextResponse.json({ notice: updated });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
