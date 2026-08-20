import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/website-config — get landlord's website configuration.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = await prisma.websiteConfig.findUnique({
    where: { userId: session.user.id },
  });

  return NextResponse.json({ config });
}

/**
 * POST /api/website-config — create website configuration.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if config already exists
    const existing = await prisma.websiteConfig.findUnique({
      where: { userId: session.user.id },
    });
    if (existing) {
      return NextResponse.json(
        { error: "Website config already exists. Use PUT to update." },
        { status: 409 }
      );
    }

    const body = await request.json();
    const { subdomain, companyName } = body;

    if (!companyName?.trim()) {
      return NextResponse.json(
        { error: "companyName is required" },
        { status: 400 }
      );
    }

    // Validate subdomain uniqueness
    if (subdomain) {
      const taken = await prisma.websiteConfig.findFirst({
        where: { subdomain },
      });
      if (taken) {
        return NextResponse.json(
          { error: "This subdomain is already taken" },
          { status: 409 }
        );
      }
    }

    const config = await prisma.websiteConfig.create({
      data: {
        userId: session.user.id,
        subdomain: subdomain || null,
        companyName,
        primaryColor: body.primaryColor || "#2563eb",
        logoUrl: body.logoUrl || null,
        heroImageUrl: body.heroImageUrl || null,
        aboutText: body.aboutText || null,
        contactEmail: body.contactEmail || null,
        contactPhone: body.contactPhone || null,
      },
    });

    return NextResponse.json({ config }, { status: 201 });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PUT /api/website-config — update website configuration.
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const config = await prisma.websiteConfig.findUnique({
      where: { userId: session.user.id },
    });
    if (!config) {
      return NextResponse.json(
        { error: "No website config found. Create one first." },
        { status: 404 }
      );
    }

    const body = await request.json();

    // Check subdomain uniqueness if changing
    if (body.subdomain && body.subdomain !== config.subdomain) {
      const taken = await prisma.websiteConfig.findFirst({
        where: { subdomain: body.subdomain, NOT: { id: config.id } },
      });
      if (taken) {
        return NextResponse.json(
          { error: "This subdomain is already taken" },
          { status: 409 }
        );
      }
    }

    // Check custom domain uniqueness if changing
    if (body.customDomain && body.customDomain !== config.customDomain) {
      const taken = await prisma.websiteConfig.findFirst({
        where: { customDomain: body.customDomain, NOT: { id: config.id } },
      });
      if (taken) {
        return NextResponse.json(
          { error: "This custom domain is already in use" },
          { status: 409 }
        );
      }
    }

    const updated = await prisma.websiteConfig.update({
      where: { id: config.id },
      data: {
        subdomain: body.subdomain ?? config.subdomain,
        customDomain: body.customDomain ?? config.customDomain,
        companyName: body.companyName ?? config.companyName,
        primaryColor: body.primaryColor ?? config.primaryColor,
        logoUrl: body.logoUrl ?? config.logoUrl,
        heroImageUrl: body.heroImageUrl ?? config.heroImageUrl,
        aboutText: body.aboutText ?? config.aboutText,
        contactEmail: body.contactEmail ?? config.contactEmail,
        contactPhone: body.contactPhone ?? config.contactPhone,
      },
    });

    return NextResponse.json({ config: updated });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
