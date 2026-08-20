import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * DELETE /api/properties/[id]/photos/[photoId] — delete a photo.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string; photoId: string } }
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

  const photo = await prisma.propertyPhoto.findFirst({
    where: { id: params.photoId, propertyId: params.id },
  });

  if (!photo) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }

  // TODO: Delete file from S3

  await prisma.propertyPhoto.delete({ where: { id: params.photoId } });

  return NextResponse.json({ success: true });
}
