import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/properties/[id]/questions — list questions for a property.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const property = await prisma.property.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!property) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  const questions = await prisma.question.findMany({
    where: { propertyId: id },
    orderBy: { sortOrder: "asc" },
  });

  return NextResponse.json({ questions });
}

/**
 * POST /api/properties/[id]/questions — add a question.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const property = await prisma.property.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!property) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }

    const { text, fieldKey, type, required, isStandard } = await request.json();

    if (!text) {
      return NextResponse.json(
        { error: "Question text is required" },
        { status: 400 }
      );
    }

    // Auto-generate fieldKey from text if not provided
    const key =
      fieldKey ||
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .trim()
        .replace(/\s+/g, "_")
        .slice(0, 40);

    // Get next sort order
    const maxOrder = await prisma.question.aggregate({
      where: { propertyId: id },
      _max: { sortOrder: true },
    });
    const nextOrder = (maxOrder._max.sortOrder ?? -1) + 1;

    const question = await prisma.question.create({
      data: {
        propertyId: id,
        text,
        fieldKey: key,
        type: type || "text",
        required: required !== undefined ? required : true,
        sortOrder: nextOrder,
        isStandard: isStandard || false,
      },
    });

    return NextResponse.json({ question }, { status: 201 });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PUT /api/properties/[id]/questions — reorder questions (bulk update).
 *
 * Body: { order: [{ id, sortOrder }] }
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

    const property = await prisma.property.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!property) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }

    const { order } = await request.json();

    if (!Array.isArray(order)) {
      return NextResponse.json(
        { error: "order must be an array of { id, sortOrder }" },
        { status: 400 }
      );
    }

    // Verify all question IDs belong to this property
    const existingQuestions = await prisma.question.findMany({
      where: { propertyId: id },
      select: { id: true },
    });
    const validIds = new Set(existingQuestions.map((q) => q.id));
    const allValid = order.every(
      (item: { id: string }) => validIds.has(item.id)
    );

    if (!allValid) {
      return NextResponse.json(
        { error: "One or more question IDs do not belong to this property" },
        { status: 403 }
      );
    }

    await prisma.$transaction(
      order.map((item: { id: string; sortOrder: number }) =>
        prisma.question.update({
          where: { id: item.id },
          data: { sortOrder: item.sortOrder },
        })
      )
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
