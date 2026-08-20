import { resolveConfig } from "@tenant-ai/shared";
import { prisma } from "./prisma.js";
import { getActiveCallCount } from "./call-registry.js";
import { MAX_CONCURRENT } from "../handlers/call-handler.js";

/**
 * Wrap TwiML/TeXML content in a Response envelope.
 * Telnyx's TeXML is Twilio-compatible, so both vendors share this format.
 */
export function twiml(content: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${content}</Response>`;
}

export type VoiceVendor = "twilio" | "telnyx";

/**
 * Build the XML response for an incoming call: capacity check, property
 * lookup, then a <Connect><Stream> pointing at our /media-stream WebSocket.
 *
 * Vendor differences:
 * - Telnyx needs bidirectionalMode="rtp" on <Stream> for two-way audio
 *   (its start/media/stop events are otherwise Twilio-shaped).
 * - The <Connect record> attribute is Twilio-only. TeXML records via a REST
 *   call once the call is live, so for Telnyx we embed a record=telnyx
 *   stream parameter that the /media-stream start handler acts on.
 */
export async function buildIncomingCallXml(
  to: string | undefined,
  from: string | undefined,
  callSid: string | undefined,
  vendor: VoiceVendor,
): Promise<string> {
  if (getActiveCallCount() >= MAX_CONCURRENT) {
    return twiml(
      "<Say>All lines are currently busy. Please try again later.</Say><Hangup/>",
    );
  }

  // For inbound calls, the property number is in `to`.
  // For outbound (test) calls, the property number is in `from`.
  if (!to && !from) {
    return twiml("<Say>An error occurred. Please try again.</Say><Hangup/>");
  }

  const property = await prisma.property.findFirst({
    where: {
      isActive: true,
      OR: [{ twilioPhone: to ?? "" }, { twilioPhone: from ?? "" }],
    },
  });

  if (!property) {
    return twiml("<Say>This number is not in service.</Say><Hangup/>");
  }

  const publicUrl =
    (await resolveConfig("twilio", "public_url", "https://localhost:3001")) ||
    "https://localhost:3001";
  const wsUrl = publicUrl
    .replace("https://", "wss://")
    .replace("http://", "ws://");

  const streamUrl = `${wsUrl}/media-stream`;

  const connectAttr =
    vendor === "twilio" && property.recordingEnabled
      ? ' record="record-from-answer-dual"'
      : "";
  const streamAttrs =
    vendor === "telnyx" ? ' bidirectionalMode="rtp"' : "";
  const recordParam =
    vendor === "telnyx" && property.recordingEnabled
      ? '<Parameter name="record" value="telnyx" />'
      : "";

  return twiml(
    `<Connect${connectAttr}><Stream url="${streamUrl}"${streamAttrs}>` +
      `<Parameter name="callSid" value="${callSid || ""}" />` +
      `<Parameter name="from" value="${from || ""}" />` +
      `<Parameter name="propertyId" value="${property.id}" />` +
      recordParam +
      `</Stream></Connect>`,
  );
}

/** Static fallback response when the primary webhook fails. */
export function fallbackXml(): string {
  return twiml(
    "<Say>Our application system is temporarily unavailable. Please try again later, or text this number to apply.</Say>",
  );
}
