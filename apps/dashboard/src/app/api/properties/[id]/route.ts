import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/properties/[id] — get a single property.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const property = await prisma.property.findFirst({
    where: { id: params.id, userId: session.user.id },
    include: {
      questions: { orderBy: { sortOrder: "asc" } },
      units: { orderBy: { unitNumber: "asc" } },
      photos: { orderBy: { sortOrder: "asc" } },
      _count: {
        select: {
          applications: true,
          callLogs: true,
        },
      },
    },
  });

  if (!property) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  return NextResponse.json({ property });
}

/**
 * PUT /api/properties/[id] — update a property.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify ownership
    const existing = await prisma.property.findFirst({
      where: { id: params.id, userId: session.user.id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }

    const body = await request.json();
    const {
      name,
      address,
      unitCount,
      description,
      amenities,
      petPolicy,
      isActive,
      aiModel,
      voiceName,
      maxCallMinutes,
      recordingEnabled,
      answerValidation,
      aiDisclosureText,
      greetingMessage,
      smsIntakeEnabled,
      intakeAutoReply,
    } = body;

    // Re-detect Cook County if address changed
    let cookCounty = existing.cookCounty;
    if (address && address !== existing.address) {
      try {
        const { isAddressInCookCounty } = await import("@tenant-ai/shared");
        cookCounty = isAddressInCookCounty(address) ?? false;
      } catch {
        // noop
      }
    }

    const property = await prisma.property.update({
      where: { id: params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(address !== undefined && { address, cookCounty }),
        ...(unitCount !== undefined && { unitCount }),
        ...(description !== undefined && { description }),
        ...(amenities !== undefined && { amenities }),
        ...(petPolicy !== undefined && { petPolicy }),
        ...(isActive !== undefined && { isActive }),
        ...(aiModel !== undefined && { aiModel }),
        ...(voiceName !== undefined && { voiceName }),
        ...(maxCallMinutes !== undefined && { maxCallMinutes }),
        ...(recordingEnabled !== undefined && { recordingEnabled }),
        ...(answerValidation !== undefined && { answerValidation }),
        ...(aiDisclosureText !== undefined && { aiDisclosureText }),
        ...(greetingMessage !== undefined && { greetingMessage }),
        ...(smsIntakeEnabled !== undefined && { smsIntakeEnabled }),
        ...(intakeAutoReply !== undefined && { intakeAutoReply }),
      },
    });

    return NextResponse.json({ property });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/properties/[id] — delete a property.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const existing = await prisma.property.findFirst({
      where: { id: params.id, userId: session.user.id },
      include: {
        _count: {
          select: { applications: { where: { status: "in_progress" } } },
        },
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }

    if (existing._count.applications > 0) {
      return NextResponse.json(
        { error: "Cannot delete property with active applications" },
        { status: 400 }
      );
    }

    // Delete related data in order
    await prisma.question.deleteMany({ where: { propertyId: params.id } });
    await prisma.propertyPhoto.deleteMany({ where: { propertyId: params.id } });
    await prisma.property.delete({ where: { id: params.id } });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
