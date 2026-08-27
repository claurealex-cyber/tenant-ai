import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSmsLeads, type SmsLeadFilters } from "@/lib/sms-leads";

/** GET: the SMS Leads view (texted-in + Zillow recipients, link kind, state). */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const params = request.nextUrl.searchParams;
    const pick = <T extends string>(key: string, allowed: T[]): T | undefined => {
      const v = params.get(key);
      return v && (allowed as string[]).includes(v) ? (v as T) : undefined;
    };
    const filters: SmsLeadFilters = {
      origin: pick("origin", ["texted_in", "zillow"]),
      linkKind: pick("linkKind", ["google_form", "hosted", "none"]),
      state: pick("state", ["applied", "opted_out", "invited", "contacted"]),
      includeTenants: params.get("includeTenants") === "true",
    };

    return NextResponse.json(await getSmsLeads(filters));
  } catch (error) {
    console.error("Admin sms-leads GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
