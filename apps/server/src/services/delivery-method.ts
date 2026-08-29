import { resolveConfig } from "@tenant-ai/shared";

/**
 * Delivery-method resolution (M0). The broadcast SUB-METHOD is per-lane:
 *   - Zillow lane:     zillow.broadcast_method
 *   - Individual lane: sms_relay.broadcast_method
 * A missing lane key falls back to the legacy GLOBAL textemall.broadcast_method
 * (so the pre-split "api" keeps applying to both lanes until a lane is explicitly
 * set), then defaults to "form". This is the ONE place the sub-method is decided;
 * both the runtime and the routing-status readout import from here so they can
 * never drift (M1/P2).
 */
export type BroadcastMethod = "api" | "form";
export type ZillowTransport = "textemall" | "relay";
export type DeliveryLane = "zillow" | "individual";

const LANE_NS: Record<DeliveryLane, string> = { zillow: "zillow", individual: "sms_relay" };

/** Per-lane api/form with legacy-global fallback. */
export async function resolveBroadcastMethod(lane: DeliveryLane): Promise<BroadcastMethod> {
  const laneVal = await resolveConfig(LANE_NS[lane], "broadcast_method");
  const legacy = laneVal == null ? await resolveConfig("textemall", "broadcast_method") : null;
  return (laneVal ?? legacy) === "api" ? "api" : "form";
}

/**
 * The Zillow lane's full delivery decision — the SINGLE source of truth extracted
 * from zillow-auto's send branch (P2). transport=relay means the Apple iMessage
 * relay; textemall+method picks direct API vs Google-Form/Zapier.
 */
export async function resolveZillowDelivery(): Promise<{ transport: ZillowTransport; method: BroadcastMethod }> {
  const transport: ZillowTransport =
    (await resolveConfig("zillow", "send_channel")) === "textemall" ? "textemall" : "relay";
  return { transport, method: await resolveBroadcastMethod("zillow") };
}
