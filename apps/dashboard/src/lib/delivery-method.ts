import { prisma } from "@/lib/prisma";
import { encrypt, clearConfigCache } from "@tenant-ai/shared";
import { proxyToServer } from "@/lib/zillow-admin";

/**
 * Single writer for the per-lane delivery method (M9). ONE place sets the keys
 * for a lane so no two UIs can produce contradictory state (P1). Writes are one
 * transaction; then BOTH config caches are cleared (dashboard in-process + the
 * running server via /internal/config/refresh) so the change is live immediately,
 * not after the 60s TTL (S2).
 *
 * method:
 *   "imessage" → transport = relay (Apple iMessage / Telnyx). Sub-method untouched.
 *   "zapier"   → transport = Text-Em-All, sub-method = Google Form → Zapier.
 *   "api"      → transport = Text-Em-All, sub-method = direct REST API.
 * Never touches the individual whitelist (P4) — that stays an explicit action.
 */
export type Lane = "zillow" | "individual";
export type Method = "imessage" | "zapier" | "api";

function up(key: string, value: string, userId: string) {
  return prisma.systemConfig.upsert({
    where: { key },
    create: { key, value: encrypt(value), updatedBy: userId },
    update: { value: encrypt(value), updatedBy: userId },
  });
}

export async function setLaneDeliveryMethod(lane: Lane, method: Method, userId: string): Promise<void> {
  const writes = [];
  if (lane === "zillow") {
    if (method === "imessage") {
      writes.push(up("zillow.send_channel", "relay", userId));
    } else {
      writes.push(up("zillow.send_channel", "textemall", userId));
      writes.push(up("zillow.broadcast_method", method === "api" ? "api" : "form", userId));
    }
  } else {
    if (method === "imessage") {
      writes.push(up("sms_relay.individual_channel", "relay", userId));
    } else {
      writes.push(up("sms_relay.individual_channel", "textemall", userId));
      writes.push(up("textemall.individual_trigger_armed", "true", userId)); // API + Zapier both need the channel armed
      writes.push(up("sms_relay.broadcast_method", method === "api" ? "api" : "form", userId));
    }
  }
  await prisma.$transaction(writes);
  await prisma.auditLog
    .create({ data: { userId, action: "delivery_method_update", resourceType: "system_config", resourceId: `${lane}.delivery_method`, metadata: { lane, method } } })
    .catch(() => {});
  clearConfigCache();
  try {
    await proxyToServer("/internal/config/refresh", { method: "POST", timeoutMs: 4000 });
  } catch {
    /* server refresh best-effort; 60s TTL is the fallback */
  }
}

/** Live effective-path readout, computed by the SERVER (single source of truth). */
export async function getRoutingStatus(): Promise<unknown> {
  const res = await proxyToServer("/internal/routing-status", { timeoutMs: 5000 });
  if (!res.ok) throw new Error(`routing-status ${res.status}`);
  return res.json();
}
