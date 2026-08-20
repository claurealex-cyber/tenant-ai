import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { tenantAuthOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/portal/messages — messages for the tenant (both from landlord and own replies).
 */
export async function GET() {
  const session = await getServerSession(tenantAuthOptions);
  if (!session?.tenant) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const messages = await prisma.message.findMany({
    where: { tenantId: session.tenant.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      subject: true,
      body: true,
      isRead: true,
      fromTenantId: true,
      replyToId: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ messages });
}

/**
 * POST /api/portal/messages — tenant replies to a landlord message.
 *
 * Body: { replyToId, body }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(tenantAuthOptions);
    if (!session?.tenant) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const data = await request.json();
    const { replyToId, body } = data;

    if (!replyToId || !body?.trim()) {
      return NextResponse.json(
        { error: "replyToId and body are required" },
        { status: 400 }
      );
    }

    // Verify parent message belongs to this tenant
    const parentMessage = await prisma.message.findUnique({
      where: { id: replyToId },
    });

    if (!parentMessage || parentMessage.tenantId !== session.tenant.id) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    const subject = parentMessage.subject.startsWith("Re: ")
      ? parentMessage.subject
      : `Re: ${parentMessage.subject}`;

    const message = await prisma.message.create({
      data: {
        tenantId: session.tenant.id,
        fromTenantId: session.tenant.id,
        replyToId,
        subject,
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
 * PUT /api/portal/messages — mark message as read.
 *
 * Body: { messageId }
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(tenantAuthOptions);
    if (!session?.tenant) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { messageId } = await request.json();
    if (!messageId) {
      return NextResponse.json({ error: "messageId required" }, { status: 400 });
    }

    // Verify ownership
    const message = await prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message || message.tenantId !== session.tenant.id) {
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
