/**
 * Tenant context resolution — resolves which landlord's data to serve
 * based on the request hostname (subdomain or custom domain).
 */

import { prisma } from "./prisma";

export interface TenantContext {
  userId: string;
  subdomain?: string | null;
  customDomain?: string | null;
  companyName: string;
  logoUrl?: string | null;
  primaryColor: string;
  heroImageUrl?: string | null;
  aboutText?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
}

/**
 * Resolve tenant context from a hostname.
 *
 * Checks custom domains first, then subdomains.
 * Returns null if no match.
 */
export async function resolveTenantContext(
  hostname: string
): Promise<TenantContext | null> {
  // Strip port if present
  const host = hostname.split(":")[0];

  // Try custom domain first
  let config = await prisma.websiteConfig.findFirst({
    where: { customDomain: host },
  });

  // Try subdomain (e.g., "acme" from "acme.tenantai.com")
  if (!config) {
    const baseDomain = process.env.TENANT_BASE_DOMAIN || "tenantai.com";
    if (host.endsWith(`.${baseDomain}`)) {
      const subdomain = host.replace(`.${baseDomain}`, "");
      config = await prisma.websiteConfig.findFirst({
        where: { subdomain },
      });
    }
  }

  if (!config) return null;

  return {
    userId: config.userId,
    subdomain: config.subdomain,
    customDomain: config.customDomain,
    companyName: config.companyName,
    logoUrl: config.logoUrl,
    primaryColor: config.primaryColor,
    heroImageUrl: config.heroImageUrl,
    aboutText: config.aboutText,
    contactEmail: config.contactEmail,
    contactPhone: config.contactPhone,
  };
}
