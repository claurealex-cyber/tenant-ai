import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET: list phone-bearing properties with their SMS intake state
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const properties = await prisma.property.findMany({
      where: { twilioPhone: { not: null } },
      select: {
        id: true,
        name: true,
        twilioPhone: true,
        isActive: true,
        smsIntakeEnabled: true,
        intakeAutoReply: true,
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ properties });
  } catch (error) {
    console.error("SMS relay property GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH: toggle smsIntakeEnabled / update intakeAutoReply for one property
export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { propertyId, smsIntakeEnabled, intakeAutoReply } = body ?? {};
    if (!propertyId || typeof propertyId !== "string") {
      return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    }

    const data: { smsIntakeEnabled?: boolean; intakeAutoReply?: string | null } = {};
    if (typeof smsIntakeEnabled === "boolean") data.smsIntakeEnabled = smsIntakeEnabled;
    if (typeof intakeAutoReply === "string") {
      data.intakeAutoReply = intakeAutoReply.trim() === "" ? null : intakeAutoReply.slice(0, 1000);
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const property = await prisma.property.update({
      where: { id: propertyId },
      data,
      select: {
        id: true,
        name: true,
        smsIntakeEnabled: true,
        intakeAutoReply: true,
      },
    });

    return NextResponse.json({ property });
  } catch (error) {
    console.error("SMS relay property PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
