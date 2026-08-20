/**
 * Shared SMS sending utility.
 * Uses Twilio REST API when configured, otherwise logs to console (dev mode).
 */

import { resolveConfig } from "./config-resolver.js";

export interface SmsOptions {
  to: string;
  from: string;
  body: string;
  mediaUrls?: string[];
}

export interface SmsResult {
  success: boolean;
  sid?: string;
  error?: string;
}

export async function sendSms(options: SmsOptions): Promise<SmsResult> {
  const accountSid = await resolveConfig("twilio", "account_sid");
  const authToken = await resolveConfig("twilio", "auth_token");

  if (!accountSid || !authToken) {
    // Development fallback: log to console
    console.log("=== SMS (dev mode) ===");
    console.log(`To: ${options.to}`);
    console.log(`From: ${options.from}`);
    console.log(`Body: ${options.body}`);
    if (options.mediaUrls?.length) {
      console.log(`Media: ${options.mediaUrls.join(", ")}`);
    }
    console.log("======================");
    return { success: true, sid: "dev-mode" };
  }

  try {
    const params = new URLSearchParams();
    params.append("To", options.to);
    params.append("From", options.from);
    params.append("Body", options.body);
    if (options.mediaUrls) {
      for (const url of options.mediaUrls) {
        params.append("MediaUrl", url);
      }
    }

    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      }
    );

    if (res.status === 201) {
      const data = (await res.json()) as { sid?: string };
      return { success: true, sid: data.sid };
    }

    const errBody = await res.text();
    console.error("[sendSms] Twilio error:", res.status, errBody);
    return { success: false, error: `Twilio API error: ${res.status}` };
  } catch (err) {
    console.error("[sendSms] Error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
