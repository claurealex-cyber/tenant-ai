import { resolveConfig } from "@tenant-ai/shared";

/**
 * Minimal Telnyx API client.
 *
 * Unlike Twilio, Telnyx webhooks don't reply via response XML — outbound
 * messages are sent through the REST API.
 * https://developers.telnyx.com/api/messaging/send-message
 */

const TELNYX_API_URL = "https://api.telnyx.com/v2/messages";
const TELNYX_TEXML_API_URL = "https://api.telnyx.com/v2/texml/Accounts";

export async function sendTelnyxSms(
  from: string,
  to: string,
  text: string,
): Promise<void> {
  const apiKey = await resolveConfig("telnyx", "api_key");
  if (!apiKey) {
    throw new Error("TELNYX_API_KEY not configured");
  }

  const response = await fetch(TELNYX_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, text }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Telnyx send failed (${response.status}): ${body.slice(0, 500)}`,
    );
  }
}

/**
 * Start dual-channel recording on a live TeXML call.
 *
 * TeXML has no <Connect record> attribute, so recording is requested via the
 * Twilio-compatible REST endpoint once the call is answered. The completed
 * recording URL arrives at /telnyx/voice/recording-status.
 * https://developers.telnyx.com/api-reference/texml-rest-commands/request-recording-for-a-call
 */
export async function startTelnyxCallRecording(callSid: string): Promise<void> {
  const apiKey = await resolveConfig("telnyx", "api_key");
  const accountSid = await resolveConfig("telnyx", "account_sid");
  if (!apiKey || !accountSid) {
    throw new Error("TELNYX_API_KEY / TELNYX_ACCOUNT_SID not configured");
  }

  const publicUrl =
    (await resolveConfig("twilio", "public_url", "http://localhost:3001")) ||
    "http://localhost:3001";

  const body = new URLSearchParams({
    PlayBeep: "false",
    RecordingChannels: "dual",
    RecordingTrack: "both",
    RecordingStatusCallback: `${publicUrl}/telnyx/voice/recording-status`,
    RecordingStatusCallbackEvent: "completed",
    SendRecordingUrl: "true",
  });

  const response = await fetch(
    `${TELNYX_TEXML_API_URL}/${encodeURIComponent(accountSid)}/Calls/${encodeURIComponent(callSid)}/Recordings.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Telnyx recording start failed (${response.status}): ${text.slice(0, 500)}`,
    );
  }
}
