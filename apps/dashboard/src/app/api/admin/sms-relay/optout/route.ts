import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const E164 = /^\+1\d{10}$/;

// POST: manually record an opt-out (mirrors a STOP seen in the personal Messages thread)
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { phone, propertyId } = body ?? {};
    if (typeof phone !== "string" || !E164.test(phone.trim())) {
      return NextResponse.json(
        { error: "phone must be E.164, e.g. +17085551234" },
        { status: 400 }
      );
    }
    if (!propertyId || typeof propertyId !== "string") {
      return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    }

    const optOut = await prisma.smsOptOut.upsert({
      where: { phone_propertyId: { phone: phone.trim(), propertyId } },
      create: { phone: phone.trim(), propertyId },
      update: {},
    });

    return NextResponse.json({ optOut });
  } catch (error) {
    console.error("SMS relay optout POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
