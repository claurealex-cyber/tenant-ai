import { prisma } from "../lib/prisma.js";

/** "$1,250/mo" from an integer cents amount. */
export function formatRent(cents: number | null | undefined): string | null {
  if (cents == null || !Number.isFinite(cents)) return null;
  const dollars = Math.round(cents) / 100;
  return `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}/mo`;
}

function unitStatus(status: string, availableDate: Date | null): string {
  if (status === "occupied") return "occupied";
  if (availableDate && availableDate.getTime() > Date.now()) {
    return `available ${availableDate.toISOString().slice(0, 10)}`;
  }
  return "available now";
}

/**
 * A compact, model-readable facts block for answering prospect questions about
 * a property. Prefers structured Unit data (rent, beds, availability); when a
 * property has no units it falls back to the free-text Description under
 * "LISTING NOTES" so the AI has *something* to answer pricing from.
 *
 * Returns { facts, hasUnits, hasAnyFacts } — the caller uses hasAnyFacts to
 * decide whether the AI can answer pricing at all.
 */
export async function buildPropertyFacts(propertyId: string): Promise<{
  facts: string;
  hasUnits: boolean;
  hasAnyFacts: boolean;
}> {
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: {
      name: true, address: true, description: true, amenities: true,
      petPolicy: true, unitCount: true,
    },
  });
  if (!property) return { facts: "", hasUnits: false, hasAnyFacts: false };

  const units = await prisma.unit.findMany({
    where: { propertyId },
    orderBy: [{ status: "asc" }, { unitNumber: "asc" }],
    select: {
      unitNumber: true, bedrooms: true, bathrooms: true, sqft: true,
      monthlyRent: true, status: true, availableDate: true, description: true,
      petPolicy: true, parkingInfo: true, utilitiesIncluded: true, laundry: true,
    },
  });

  const lines: string[] = [];
  lines.push(`PROPERTY: ${property.name} — ${property.address}`);
  if (property.description) lines.push(`Overview: ${property.description}`);
  if (property.amenities?.length) lines.push(`Amenities: ${property.amenities.join(", ")}`);
  if (property.petPolicy) lines.push(`Pet policy: ${property.petPolicy}`);

  const hasUnits = units.length > 0;
  if (hasUnits) {
    lines.push("");
    lines.push("UNITS:");
    for (const u of units) {
      const parts: string[] = [`Unit ${u.unitNumber}`];
      const bb: string[] = [];
      if (u.bedrooms != null) bb.push(`${u.bedrooms} bed`);
      if (u.bathrooms != null) bb.push(`${u.bathrooms} bath`);
      if (u.sqft != null) bb.push(`${u.sqft} sqft`);
      if (bb.length) parts.push(bb.join("/"));
      const rent = formatRent(u.monthlyRent);
      if (rent) parts.push(rent);
      parts.push(unitStatus(u.status, u.availableDate));
      const extra: string[] = [];
      if (u.petPolicy) extra.push(`pets: ${u.petPolicy}`);
      if (u.parkingInfo) extra.push(`parking: ${u.parkingInfo}`);
      if (u.utilitiesIncluded) extra.push(`utilities: ${u.utilitiesIncluded}`);
      if (u.laundry) extra.push(`laundry: ${u.laundry}`);
      if (u.description) extra.push(u.description);
      let line = "- " + parts.join(", ");
      if (extra.length) line += " (" + extra.join("; ") + ")";
      lines.push(line);
    }
  } else if (property.description) {
    lines.push("");
    lines.push("LISTING NOTES (no structured unit/pricing data — answer pricing only from these notes):");
    lines.push(property.description);
  }

  const hasAnyFacts = hasUnits || !!property.description || !!property.amenities?.length || !!property.petPolicy;
  return { facts: lines.join("\n"), hasUnits, hasAnyFacts };
}
