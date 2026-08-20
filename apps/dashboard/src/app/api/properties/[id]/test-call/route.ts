import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/properties/[id]/test-call — trigger a test outbound call to the landlord's phone.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const property = await prisma.property.findFirst({
    where: { id, userId: (session.user as any).id },
  });

  if (!property) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  if (!property.twilioPhone) {
    return NextResponse.json(
      { error: "Property does not have a phone number configured" },
      { status: 400 }
    );
  }

  if (!property.isActive) {
    return NextResponse.json(
      { error: "Property must be active to make test calls" },
      { status: 400 }
    );
  }

  let body: { phoneNumber?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  const { phoneNumber } = body;

  if (!phoneNumber) {
    return NextResponse.json(
      { error: "phoneNumber is required" },
      { status: 400 }
    );
  }

  const { resolveIntegration } = await import("@tenant-ai/shared");
  const config = await resolveIntegration("twilio");
  const accountSid = config.account_sid;
  const authToken = config.auth_token;
  const publicUrl = config.public_url || "http://localhost:3001";

  if (!accountSid || !authToken) {
    return NextResponse.json(
      { error: "Twilio is not configured" },
      { status: 500 }
    );
  }

  try {
    const twilio = (await import("twilio")).default;
    const client = twilio(accountSid, authToken);

    const call = await client.calls.create({
      to: phoneNumber,
      from: property.twilioPhone,
      url: `${publicUrl}/voice/incoming`,
    });

    return NextResponse.json({ callSid: call.sid });
  } catch (err: any) {
    console.error("Test call error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to initiate test call" },
      { status: 500 }
    );
  }
}
