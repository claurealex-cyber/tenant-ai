import { prisma } from "@/lib/prisma";

/**
 * SMS Leads view — everyone who texted the company number and/or was sent a
 * survey link, with which KIND of link they got (Google Form vs hosted).
 *
 * Durability rules (zillow-auto-plan.md §2b): the row universe is
 * SurveyInvite-primary — SmsConversation is purged 24h after last activity, so
 * conversations only (a) add "contacted, no link yet" rows for texters who
 * never got a link and (b) attach transcripts while they still exist. The
 * lead's own words come from the durable `SurveyInvite.inboundMessage`
 * snapshot (or ZillowLead.lastMessage for blast recipients).
 */

export type SmsLeadOrigin = "texted_in" | "zillow";
export type SmsLeadLinkKind = "google_form" | "hosted" | "none";
export type SmsLeadState = "applied" | "opted_out" | "invited" | "contacted";

export interface SmsLeadRow {
  key: string; // `${phone}|${propertyId}`
  phone: string;
  name: string | null;
  propertyId: string;
  propertyName: string;
  firstContactAt: string | null;
  origins: SmsLeadOrigin[];
  linkKind: SmsLeadLinkKind;
  delivery: { status: string; sentAt: string | null; lastError: string | null } | null;
  state: SmsLeadState;
  isTenant: boolean;
  inboundMessage: string | null;
  /** live transcript — null once the 24h SmsConversation purge has run */
  transcript: Array<{ role: string; content: string }> | null;
}

export interface SmsLeadFilters {
  origin?: SmsLeadOrigin;
  linkKind?: SmsLeadLinkKind;
  state?: SmsLeadState;
  includeTenants?: boolean;
  /** restrict to one landlord's properties (defense-in-depth for scoping) */
  userId?: string;
}

export interface SmsLeadsResult {
  rows: SmsLeadRow[];
  counts: {
    total: number;
    textedIn: number;
    zillow: number;
    googleForm: number;
    hosted: number;
    applied: number;
    optedOut: number;
    tenants: number;
  };
}

export async function getSmsLeads(filters: SmsLeadFilters = {}): Promise<SmsLeadsResult> {
  // SmsConversation has no `property` relation (scalar propertyId only), so
  // property identity is resolved through one lookup map for both tables.
  const properties = await prisma.property.findMany({
    where: filters.userId ? { userId: filters.userId } : {},
    select: { id: true, name: true, userId: true },
  });
  const propertyById = new Map(properties.map((p) => [p.id, p]));
  const propertyIds = properties.map((p) => p.id);

  const [invites, conversations, zillowLeads, optOuts] = await Promise.all([
    prisma.surveyInvite.findMany({
      where: { propertyId: { in: propertyIds } },
      include: {
        application: { select: { fullName: true, status: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.smsConversation.findMany({
      where: { propertyId: { in: propertyIds } },
    }),
    prisma.zillowLead.findMany({
      where: { inviteId: { not: null } },
      select: { inviteId: true, name: true, lastMessage: true },
    }),
    prisma.smsOptOut.findMany({ select: { phone: true, propertyId: true } }),
  ]);

  const zillowByInvite = new Map(zillowLeads.map((l) => [l.inviteId!, l]));
  const optedOut = new Set(optOuts.map((o) => `${o.phone}|${o.propertyId}`));

  // Tenant phones per landlord (a tenant of landlord X is not a lead of X's properties)
  const tenants = await prisma.tenant.findMany({ select: { phone: true, userId: true } });
  const tenantKeys = new Set(tenants.filter((t) => t.phone).map((t) => `${t.phone}|${t.userId}`));

  // Latest ledger row per invite
  const inviteIds = invites.map((i) => i.id);
  const ledger = inviteIds.length
    ? await prisma.outboundRelayMessage.findMany({
        where: { inviteId: { in: inviteIds } },
        orderBy: { createdAt: "desc" },
        select: { inviteId: true, status: true, sentAt: true, lastError: true },
      })
    : [];
  const latestLedgerByInvite = new Map<string, (typeof ledger)[number]>();
  for (const row of ledger) {
    if (row.inviteId && !latestLedgerByInvite.has(row.inviteId)) latestLedgerByInvite.set(row.inviteId, row);
  }

  interface Acc {
    phone: string;
    propertyId: string;
    propertyName: string;
    userId: string;
    invites: typeof invites;
    conversation: (typeof conversations)[number] | null;
  }
  const acc = new Map<string, Acc>();

  for (const invite of invites) {
    const prop = propertyById.get(invite.propertyId);
    if (!prop) continue;
    const key = `${invite.phone}|${invite.propertyId}`;
    const entry = acc.get(key) ?? {
      phone: invite.phone,
      propertyId: invite.propertyId,
      propertyName: prop.name,
      userId: prop.userId,
      invites: [] as typeof invites,
      conversation: null,
    };
    entry.invites.push(invite);
    acc.set(key, entry);
  }
  for (const conv of conversations) {
    const prop = propertyById.get(conv.propertyId);
    if (!prop) continue;
    const key = `${conv.callerPhone}|${conv.propertyId}`;
    const entry = acc.get(key) ?? {
      phone: conv.callerPhone,
      propertyId: conv.propertyId,
      propertyName: prop.name,
      userId: prop.userId,
      invites: [] as typeof invites,
      conversation: null,
    };
    entry.conversation = conv;
    acc.set(key, entry);
  }

  const rows: SmsLeadRow[] = [];
  for (const entry of acc.values()) {
    const latestInvite = entry.invites.at(-1) ?? null;
    const zillowHit = entry.invites.find((i) => zillowByInvite.has(i.id));
    const zillowLead = zillowHit ? zillowByInvite.get(zillowHit.id)! : null;

    // Origins are a SET. "Texted in" evidence must be durable: a non-Zillow
    // invite, the inboundMessage snapshot, or a (still-live) conversation.
    const origins: SmsLeadOrigin[] = [];
    const textedIn =
      entry.invites.some((i) => !zillowByInvite.has(i.id)) ||
      entry.invites.some((i) => i.inboundMessage) ||
      entry.conversation !== null;
    if (textedIn) origins.push("texted_in");
    if (zillowLead) origins.push("zillow");

    const linkKind: SmsLeadLinkKind = latestInvite
      ? latestInvite.channel === "google_form"
        ? "google_form"
        : "hosted"
      : "none";

    const appliedInvite = entry.invites.find(
      (i) => i.application && ["completed", "reviewed"].includes(i.application.status),
    );
    const isOptedOut = optedOut.has(`${entry.phone}|${entry.propertyId}`);
    const state: SmsLeadState = appliedInvite
      ? "applied"
      : isOptedOut
        ? "opted_out"
        : latestInvite
          ? "invited"
          : "contacted";

    const transcript = entry.conversation
      ? ((entry.conversation.messages as Array<{ role: string; content: string }>) ?? null)
      : null;
    const lastUserLine = transcript?.filter((m) => m.role === "user").at(-1)?.content ?? null;

    rows.push({
      key: `${entry.phone}|${entry.propertyId}`,
      phone: entry.phone,
      name: appliedInvite?.application?.fullName ?? entry.invites.find((i) => i.application?.fullName)?.application?.fullName ?? zillowLead?.name ?? null,
      propertyId: entry.propertyId,
      propertyName: entry.propertyName,
      firstContactAt: (entry.invites[0]?.createdAt ?? entry.conversation?.createdAt)?.toISOString() ?? null,
      origins,
      linkKind,
      delivery: latestInvite
        ? (() => {
            const l = latestLedgerByInvite.get(latestInvite.id);
            return l ? { status: l.status, sentAt: l.sentAt?.toISOString() ?? null, lastError: l.lastError } : null;
          })()
        : null,
      state,
      isTenant: tenantKeys.has(`${entry.phone}|${entry.userId}`),
      inboundMessage:
        entry.invites.find((i) => i.inboundMessage)?.inboundMessage ?? zillowLead?.lastMessage ?? lastUserLine,
      transcript,
    });
  }

  // Sort newest-first by first contact
  rows.sort((a, b) => (b.firstContactAt ?? "").localeCompare(a.firstContactAt ?? ""));

  const counts = {
    total: rows.filter((r) => !r.isTenant).length,
    textedIn: rows.filter((r) => !r.isTenant && r.origins.includes("texted_in")).length,
    zillow: rows.filter((r) => !r.isTenant && r.origins.includes("zillow")).length,
    googleForm: rows.filter((r) => !r.isTenant && r.linkKind === "google_form").length,
    hosted: rows.filter((r) => !r.isTenant && r.linkKind === "hosted").length,
    applied: rows.filter((r) => !r.isTenant && r.state === "applied").length,
    optedOut: rows.filter((r) => !r.isTenant && r.state === "opted_out").length,
    tenants: rows.filter((r) => r.isTenant).length,
  };

  let filtered = rows;
  if (!filters.includeTenants) filtered = filtered.filter((r) => !r.isTenant);
  if (filters.origin) filtered = filtered.filter((r) => r.origins.includes(filters.origin!));
  if (filters.linkKind) filtered = filtered.filter((r) => r.linkKind === filters.linkKind);
  if (filters.state) filtered = filtered.filter((r) => r.state === filters.state);

  return { rows: filtered, counts };
}
