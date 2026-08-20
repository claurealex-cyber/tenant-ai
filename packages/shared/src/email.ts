/**
 * Shared email sending utility.
 * Uses SendGrid when configured, otherwise logs to console (dev mode).
 */

import { resolveConfig } from "./config-resolver.js";

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail(options: EmailOptions): Promise<boolean> {
  const apiKey = await resolveConfig("sendgrid", "api_key");
  const fromEmail =
    (await resolveConfig(
      "sendgrid",
      "from_email",
      "noreply@tenant-ai.com"
    )) || "noreply@tenant-ai.com";

  if (!apiKey) {
    // Development fallback: log to console
    console.log("=== Email (dev mode) ===");
    console.log(`To: ${options.to}`);
    console.log(`Subject: ${options.subject}`);
    console.log(`Body: ${options.html}`);
    console.log("========================");
    return true;
  }

  try {
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: options.to }] }],
        from: { email: fromEmail },
        subject: options.subject,
        content: [{ type: "text/html", value: options.html }],
      }),
    });

    return res.ok || res.status === 202;
  } catch (err) {
    console.error("Failed to send email:", err);
    return false;
  }
}
