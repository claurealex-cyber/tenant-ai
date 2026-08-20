import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

/**
 * GET /api/twilio/available-numbers?areaCode=312 — search for available phone numbers.
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const areaCode = request.nextUrl.searchParams.get("areaCode") || "312";

  const { resolveConfig } = await import("@tenant-ai/shared");
  const accountSid = await resolveConfig("twilio", "account_sid") || process.env.TWILIO_ACCOUNT_SID;
  const authToken = await resolveConfig("twilio", "auth_token") || process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    // Return mock numbers when Twilio is not configured
    const mockNumbers = Array.from({ length: 5 }, (_, i) => ({
      phoneNumber: `+1${areaCode}555${String(1000 + i).slice(-4)}`,
      friendlyName: `(${areaCode}) 555-${String(1000 + i).slice(-4)}`,
      locality: "Chicago",
      region: "IL",
    }));

    return NextResponse.json({ numbers: mockNumbers, mock: true });
  }

  try {
    const twilio = (await import("twilio")).default;
    const client = twilio(accountSid, authToken);

    const available = await client
      .availablePhoneNumbers("US")
      .local.list({ areaCode: parseInt(areaCode, 10), limit: 10 });

    const numbers = available.map((n) => ({
      phoneNumber: n.phoneNumber,
      friendlyName: n.friendlyName,
      locality: n.locality,
      region: n.region,
    }));

    return NextResponse.json({ numbers, mock: false });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to search phone numbers" },
      { status: 500 }
    );
  }
}
