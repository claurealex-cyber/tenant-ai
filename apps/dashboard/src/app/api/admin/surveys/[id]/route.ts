import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@tenant-ai/shared";

/**
 * GET /api/admin/surveys/[id] — single survey application (admin only).
 *
 * dateOfBirth is omitted by default; pass ?include=pii to receive it
 * (decrypted when it is a versioned ciphertext, e.g. "v1:...").
 * Raw SSN is never returned here — only an ssnPresent flag.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const application = await prisma.application.findUnique({
      where: { id },
      include: {
        property: { select: { id: true, name: true } },
      },
    });

    if (!application) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { dateOfBirth, ssn, ...rest } = application;

    const result: Record<string, unknown> = {
      ...rest,
      ssnPresent: !!ssn,
    };

    if (request.nextUrl.searchParams.get("include") === "pii" && dateOfBirth) {
      if (/^v\d+:/.test(dateOfBirth)) {
        try {
          result.dateOfBirth = decrypt(dateOfBirth);
        } catch (err) {
          console.error("Admin surveys DOB decrypt error:", err);
          return NextResponse.json(
            { error: "Failed to decrypt dateOfBirth" },
            { status: 500 },
          );
        }
      } else {
        // Legacy plaintext value — return as stored.
        result.dateOfBirth = dateOfBirth;
      }
    }

    return NextResponse.json({ application: result });
  } catch (error) {
    console.error("Admin surveys [id] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
