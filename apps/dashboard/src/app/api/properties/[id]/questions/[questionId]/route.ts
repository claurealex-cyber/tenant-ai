import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * PUT /api/properties/[id]/questions/[questionId] — update a question.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; questionId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, questionId } = await params;

    const property = await prisma.property.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!property) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }

    const question = await prisma.question.findFirst({
      where: { id: questionId, propertyId: id },
    });

    if (!question) {
      return NextResponse.json({ error: "Question not found" }, { status: 404 });
    }

    const { text, type, required } = await request.json();

    // For standard questions, only text and required can be changed
    const updateData: Record<string, unknown> = {};
    if (text !== undefined) updateData.text = text;
    if (required !== undefined) updateData.required = required;

    // Non-standard questions can also change type
    if (!question.isStandard && type !== undefined) {
      updateData.type = type;
    }

    const updated = await prisma.question.update({
      where: { id: questionId },
      data: updateData,
    });

    return NextResponse.json({ question: updated });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/properties/[id]/questions/[questionId] — delete a question.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; questionId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, questionId } = await params;

    const property = await prisma.property.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!property) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }

    const question = await prisma.question.findFirst({
      where: { id: questionId, propertyId: id },
    });

    if (!question) {
      return NextResponse.json({ error: "Question not found" }, { status: 404 });
    }

    if (question.isStandard) {
      return NextResponse.json(
        { error: "Standard questions cannot be deleted" },
        { status: 400 }
      );
    }

    await prisma.question.delete({ where: { id: questionId } });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
