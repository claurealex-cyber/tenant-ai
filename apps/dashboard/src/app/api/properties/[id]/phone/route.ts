import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { WEBHOOK_PATHS } from "@/lib/phone-system";

/**
 * POST /api/properties/[id]/phone — provision a Twilio phone number.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
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

    if (property.twilioPhone) {
      return NextResponse.json(
        { error: "Property already has a phone number" },
        { status: 400 }
      );
    }

    const { phoneNumber, phoneSid: providedSid } = await request.json();

    if (!phoneNumber) {
      return NextResponse.json(
        { error: "phoneNumber is required" },
        { status: 400 }
      );
    }

    let phoneSid = providedSid;

    // If no SID provided, purchase the number from Twilio
    if (!phoneSid) {
      const { resolveConfig } = await import("@tenant-ai/shared");
      const accountSid = await resolveConfig("twilio", "account_sid") || process.env.TWILIO_ACCOUNT_SID;
      const authToken = await resolveConfig("twilio", "auth_token") || process.env.TWILIO_AUTH_TOKEN;
      const publicUrl = await resolveConfig("twilio", "public_url") || process.env.PUBLIC_URL || "http://localhost:3001";

      if (accountSid && authToken) {
        try {
          const twilio = (await import("twilio")).default;
          const client = twilio(accountSid, authToken);
          const purchased = await client.incomingPhoneNumbers.create({
            phoneNumber,
            voiceUrl: `${publicUrl}${WEBHOOK_PATHS.voice}`,
            voiceMethod: "POST",
            voiceFallbackUrl: `${publicUrl}${WEBHOOK_PATHS.voiceFallback}`,
            voiceFallbackMethod: "POST",
            smsUrl: `${publicUrl}${WEBHOOK_PATHS.sms}`,
            smsMethod: "POST",
          });
          phoneSid = purchased.sid;
        } catch (purchaseErr) {
          console.error("Twilio purchase error:", purchaseErr);
          return NextResponse.json(
            { error: "Failed to purchase phone number from Twilio" },
            { status: 500 }
          );
        }
      } else {
        // Mock mode — generate a fake SID
        phoneSid = `PN_mock_${Date.now()}`;
      }
    }

    try {
      const updated = await prisma.property.update({
        where: { id: params.id },
        data: {
          twilioPhone: phoneNumber,
          twilioPhoneSid: phoneSid,
          isActive: true,
        },
      });

      return NextResponse.json({ property: updated });
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code: string }).code === "P2002"
      ) {
        return NextResponse.json(
          { error: "This phone number is already assigned to another property" },
          { status: 409 }
        );
      }
      throw err;
    }
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/properties/[id]/phone — release a Twilio phone number.
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

    const property = await prisma.property.findFirst({
      where: { id: params.id, userId: session.user.id },
    });

    if (!property) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }

    if (!property.twilioPhone) {
      return NextResponse.json(
        { error: "Property has no phone number" },
        { status: 400 }
      );
    }

    // Release the number from Twilio if configured
    if (property.twilioPhoneSid && !property.twilioPhoneSid.startsWith("PN_mock_")) {
      try {
        const { resolveConfig } = await import("@tenant-ai/shared");
        const accountSid = await resolveConfig("twilio", "account_sid") || process.env.TWILIO_ACCOUNT_SID;
        const authToken = await resolveConfig("twilio", "auth_token") || process.env.TWILIO_AUTH_TOKEN;
        if (accountSid && authToken) {
          const twilio = (await import("twilio")).default;
          const client = twilio(accountSid, authToken);
          await client.incomingPhoneNumbers(property.twilioPhoneSid).remove();
        }
      } catch (releaseErr) {
        console.error("Twilio release error:", releaseErr);
        // Continue with DB cleanup even if Twilio release fails
      }
    }

    const updated = await prisma.property.update({
      where: { id: params.id },
      data: {
        twilioPhone: null,
        twilioPhoneSid: null,
        isActive: false,
      },
    });

    return NextResponse.json({ property: updated });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
