import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/messages — list all messages for the landlord's tenants (bidirectional).
 *
 * Query params: tenantId
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = request.nextUrl.searchParams.get("tenantId");

  const where: Record<string, unknown> = {
    tenant: { userId: session.user.id },
  };
  if (tenantId) where.tenantId = tenantId;

  const messages = await prisma.message.findMany({
    where,
    include: {
      tenant: {
        select: { firstName: true, lastName: true, email: true },
      },
      fromTenant: {
        select: { firstName: true, lastName: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ messages });
}

/**
 * POST /api/messages — send a message to a tenant.
 *
 * Body: { tenantId, subject, body }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const data = await request.json();
    const { tenantId, subject, body } = data;

    if (!tenantId || !subject?.trim() || !body?.trim()) {
      return NextResponse.json(
        { error: "tenantId, subject, and body are required" },
        { status: 400 }
      );
    }

    // Verify the tenant belongs to this landlord
    const tenant = await prisma.tenant.findFirst({
      where: { id: tenantId, userId: session.user.id },
    });
    if (!tenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    const message = await prisma.message.create({
      data: {
        tenantId,
        fromUserId: session.user.id,
        subject: subject.trim(),
        body: body.trim(),
      },
    });

    return NextResponse.json({ message }, { status: 201 });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PUT /api/messages — mark a tenant reply as read.
 *
 * Body: { messageId }
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { messageId } = await request.json();
    if (!messageId) {
      return NextResponse.json({ error: "messageId required" }, { status: 400 });
    }

    // Verify message belongs to one of this landlord's tenants
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: { tenant: { select: { userId: true } } },
    });

    if (!message || message.tenant.userId !== session.user.id) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    const updated = await prisma.message.update({
      where: { id: messageId },
      data: { isRead: true },
    });

    return NextResponse.json({ message: updated });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
