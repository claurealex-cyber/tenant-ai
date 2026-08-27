import { spawn } from "child_process";
import { prisma } from "@/lib/prisma";

/**
 * Phone system orchestration: brings up the ngrok tunnel that exposes the
 * voice/SMS server to Twilio and keeps the Twilio number webhooks pointed
 * at the routes the server actually serves.
 *
 * Tunnel target model. The single static ngrok domain can point at either:
 *   • the Caddy proxy (PROXY_PORT, default 3010) — path split: webhook/survey
 *     paths → Fastify, everything else → this dashboard. "Web access ON":
 *     the dashboard is reachable from the internet on the same domain.
 *   • the Fastify server directly (SERVER_PORT) — "Web access OFF" / the
 *     quota kill-switch / the fallback when Caddy isn't running. Phones and
 *     the hosted survey keep working; the dashboard is local-only.
 * BOTH are healthy states. Only a tunnel pointed anywhere else is "wrong".
 * (Before this model, the status check compared the target to SERVER_PORT
 * only, so the proxy read as broken and "Start" would silently retarget the
 * tunnel to the server — killing public dashboard access.)
 */

const NGROK_API = process.env.NGROK_API_URL || "http://127.0.0.1:4040";
const TUNNEL_NAME = "tenant-ai";

// Paths registered by apps/server (routes/twilio-voice.ts, routes/twilio-sms.ts)
export const WEBHOOK_PATHS = {
  voice: "/voice/incoming",
  voiceFallback: "/voice/fallback",
  sms: "/sms/incoming",
} as const;

export interface PhoneSystemStep {
  name: string;
  ok: boolean;
  skipped?: boolean;
  detail: string;
}

export interface PhoneNumberStatus {
  propertyId: string;
  propertyName: string;
  phone: string;
  webhooksOk: boolean | null; // null = could not check
}

/** Where the static domain currently lands. */
export type TunnelTarget = "proxy" | "server" | "other";

export interface PhoneSystemStatus {
  configured: boolean;
  publicUrl: string | null;
  serverPort: number;
  proxyPort: number;
  /** Caddy answering on PROXY_PORT (checked via its /health passthrough). */
  proxyUp: boolean;
  tunnel: {
    running: boolean;
    forwardsTo: string | null;
    /** true for BOTH proxy and server targets — only "other" is wrong. */
    correct: boolean;
    target: TunnelTarget | null;
  };
  /** Dashboard reachable from the internet (tunnel → proxy). */
  webPublic: boolean;
  publicHealthOk: boolean;
  numbers: PhoneNumberStatus[];
  ready: boolean;
}

function serverPort(): number {
  return parseInt(process.env.SERVER_PORT || "3001", 10);
}

function proxyPort(): number {
  return parseInt(process.env.PROXY_PORT || "3010", 10);
}

/** Classify an ngrok `config.addr` (e.g. "http://localhost:3010") by port. */
export function classifyTunnelTarget(
  addr: string,
  ports: { server: number; proxy: number },
): TunnelTarget {
  const m = /:(\d+)\/?$/.exec(addr);
  const port = m ? parseInt(m[1], 10) : NaN;
  if (port === ports.proxy) return "proxy";
  if (port === ports.server) return "server";
  return "other";
}

/** Is Caddy up on PROXY_PORT? Its /health passthrough must answer from Fastify. */
async function isProxyUp(): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`http://127.0.0.1:${proxyPort()}/health`, {}, 1500);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * The port the tunnel SHOULD point at when (re)starting: the proxy when it
 * is up (web access on), else the server directly (phones never wait on Caddy).
 */
async function desiredTunnelPort(): Promise<{ port: number; target: TunnelTarget }> {
  if (await isProxyUp()) return { port: proxyPort(), target: "proxy" };
  return { port: serverPort(), target: "server" };
}

async function getTwilioConfig() {
  const { resolveConfig } = await import("@tenant-ai/shared");
  const accountSid =
    (await resolveConfig("twilio", "account_sid")) ||
    process.env.TWILIO_ACCOUNT_SID ||
    null;
  const authToken =
    (await resolveConfig("twilio", "auth_token")) ||
    process.env.TWILIO_AUTH_TOKEN ||
    null;
  const rawUrl =
    (await resolveConfig("twilio", "public_url")) ||
    process.env.PUBLIC_URL ||
    null;
  const publicUrl = rawUrl ? rawUrl.replace(/\/+$/, "") : null;
  return { accountSid, authToken, publicUrl };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 3000
): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

interface NgrokTunnel {
  name: string;
  public_url: string;
  config: { addr: string };
}

/** Returns the agent's tunnels, or null when the ngrok agent isn't running. */
async function listNgrokTunnels(): Promise<NgrokTunnel[] | null> {
  try {
    const res = await fetchWithTimeout(`${NGROK_API}/api/tunnels`, {}, 2000);
    if (!res.ok) return null;
    const data = await res.json();
    return data.tunnels || [];
  } catch {
    return null;
  }
}

function tunnelForDomain(
  tunnels: NgrokTunnel[],
  publicUrl: string
): NgrokTunnel | null {
  const host = new URL(publicUrl).host;
  return tunnels.find((t) => new URL(t.public_url).host === host) || null;
}

function tunnelPortMatches(tunnel: NgrokTunnel, port: number): boolean {
  // addr looks like "http://localhost:3001"
  return tunnel.config.addr.endsWith(`:${port}`);
}

/**
 * Retarget the static domain to `port` through the running agent's API
 * (delete + recreate — ngrok tunnels are immutable). Returns null on success,
 * else a human-readable failure.
 */
async function retargetTunnel(publicUrl: string, port: number): Promise<string | null> {
  const tunnels = await listNgrokTunnels();
  if (!tunnels) return "ngrok agent is not running";
  const domain = new URL(publicUrl).host;
  const existing = tunnelForDomain(tunnels, publicUrl);
  if (existing && tunnelPortMatches(existing, port)) return null;
  if (existing) {
    await fetchWithTimeout(
      `${NGROK_API}/api/tunnels/${encodeURIComponent(existing.name)}`,
      { method: "DELETE" },
      3000
    ).catch(() => undefined);
  }
  const created = await fetchWithTimeout(
    `${NGROK_API}/api/tunnels`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: TUNNEL_NAME, proto: "http", addr: String(port), domain }),
    },
    5000
  ).catch(() => null);
  return created?.ok ? null : "ngrok agent is running but the tunnel could not be recreated";
}

/**
 * Web access switch: ON → tunnel to the Caddy proxy (dashboard public);
 * OFF → tunnel straight to the Fastify server (quota kill-switch — phones and
 * the hosted survey keep working, dashboard goes local-only).
 */
export async function setWebAccess(on: boolean): Promise<{ ok: boolean; steps: PhoneSystemStep[] }> {
  const steps: PhoneSystemStep[] = [];
  const { publicUrl } = await getTwilioConfig();
  if (!publicUrl) {
    steps.push({ name: "Web access", ok: false, detail: "No public URL configured." });
    return { ok: false, steps };
  }
  if (on && !(await isProxyUp())) {
    steps.push({
      name: "Web access",
      ok: false,
      detail: `Caddy proxy is not answering on 127.0.0.1:${proxyPort()} — start it (start.sh runs it) before turning web access on.`,
    });
    return { ok: false, steps };
  }
  const port = on ? proxyPort() : serverPort();
  const err = await retargetTunnel(publicUrl, port);
  steps.push({
    name: "Web access",
    ok: !err,
    detail:
      err ??
      (on
        ? `ON — ${publicUrl} → proxy :${port} (dashboard public)`
        : `OFF — ${publicUrl} → server :${port} (dashboard local-only; restore with ./start.sh web-on on the Mac or a Dock relaunch)`),
  });
  return { ok: !err, steps };
}

/**
 * Ensure an ngrok tunnel exists for publicUrl → localhost:port.
 * Reuses a matching tunnel, retargets a mismatched one via the agent API,
 * or spawns a new agent when none is running.
 */
async function ensureTunnel(
  publicUrl: string,
  port: number
): Promise<PhoneSystemStep> {
  const name = "ngrok tunnel";
  const domain = new URL(publicUrl).host;

  let tunnels = await listNgrokTunnels();

  if (tunnels) {
    const existing = tunnelForDomain(tunnels, publicUrl);
    if (existing && tunnelPortMatches(existing, port)) {
      return { name, ok: true, detail: `Already running → localhost:${port}` };
    }
    if (existing) {
      // Wrong target port — drop it so we can recreate it correctly.
      await fetchWithTimeout(
        `${NGROK_API}/api/tunnels/${encodeURIComponent(existing.name)}`,
        { method: "DELETE" },
        3000
      ).catch(() => undefined);
    }
    const created = await fetchWithTimeout(
      `${NGROK_API}/api/tunnels`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: TUNNEL_NAME,
          proto: "http",
          addr: String(port),
          domain,
        }),
      },
      5000
    ).catch(() => null);
    if (created?.ok) {
      return { name, ok: true, detail: `Started → localhost:${port}` };
    }
    return {
      name,
      ok: false,
      detail:
        "ngrok agent is running but the tunnel could not be created. Restart ngrok manually.",
    };
  }

  // Agent not running — spawn it detached so it outlives this request.
  const ngrokBin = process.env.NGROK_PATH || "ngrok";
  try {
    const child = spawn(
      ngrokBin,
      ["http", `--url=${domain}`, String(port), "--log=stdout"],
      { detached: true, stdio: "ignore" }
    );
    child.unref();
  } catch (err) {
    return {
      name,
      ok: false,
      detail: `Failed to launch ngrok: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Wait for the agent to come up and establish the tunnel.
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    tunnels = await listNgrokTunnels();
    if (tunnels && tunnelForDomain(tunnels, publicUrl)) {
      return { name, ok: true, detail: `Started → localhost:${port}` };
    }
  }
  return {
    name,
    ok: false,
    detail:
      "ngrok did not come up within 15s. Check that ngrok is installed and authenticated (ngrok config check).",
  };
}

/** Verify the server is reachable from the internet through the tunnel. */
async function checkPublicHealth(publicUrl: string): Promise<boolean> {
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetchWithTimeout(`${publicUrl}/health`, {}, 3000);
      if (res.ok) return true;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

// Real Twilio SIDs are "PN" + 32 hex chars; seed/mock data uses
// placeholders like PN_DEMO_001 or PN_mock_<timestamp>.
const TWILIO_SID_PATTERN = /^PN[0-9a-f]{32}$/;

/** Properties with a real (non-mock, non-demo) provisioned Twilio number. */
async function realNumbers() {
  const properties = await prisma.property.findMany({
    where: { twilioPhoneSid: { not: null } },
    select: { id: true, name: true, twilioPhone: true, twilioPhoneSid: true },
  });
  return properties.filter(
    (p) => p.twilioPhoneSid && TWILIO_SID_PATTERN.test(p.twilioPhoneSid)
  );
}

/** Point every provisioned number's webhooks at the server's real routes. */
async function syncWebhooks(
  accountSid: string,
  authToken: string,
  publicUrl: string
): Promise<PhoneSystemStep> {
  const name = "Twilio webhooks";
  const numbers = await realNumbers();
  if (numbers.length === 0) {
    return { name, ok: true, detail: "No provisioned numbers to update" };
  }

  const twilio = (await import("twilio")).default;
  const client = twilio(accountSid, authToken);

  const updated: string[] = [];
  const failed: string[] = [];
  for (const property of numbers) {
    try {
      await client.incomingPhoneNumbers(property.twilioPhoneSid!).update({
        voiceUrl: `${publicUrl}${WEBHOOK_PATHS.voice}`,
        voiceMethod: "POST",
        voiceFallbackUrl: `${publicUrl}${WEBHOOK_PATHS.voiceFallback}`,
        voiceFallbackMethod: "POST",
        smsUrl: `${publicUrl}${WEBHOOK_PATHS.sms}`,
        smsMethod: "POST",
      });
      updated.push(property.twilioPhone!);
    } catch (err) {
      console.error(`Webhook update failed for ${property.twilioPhone}:`, err);
      failed.push(property.twilioPhone!);
    }
  }

  if (failed.length > 0) {
    return {
      name,
      ok: false,
      detail: `Updated ${updated.length}, failed for ${failed.join(", ")}`,
    };
  }
  return { name, ok: true, detail: `Webhooks set for ${updated.join(", ")}` };
}

/**
 * Start everything the Twilio number needs: tunnel up, server publicly
 * reachable, webhooks pointed at the right routes.
 */
export async function startPhoneSystem(): Promise<{
  ready: boolean;
  steps: PhoneSystemStep[];
}> {
  const steps: PhoneSystemStep[] = [];
  const { accountSid, authToken, publicUrl } = await getTwilioConfig();

  if (!publicUrl) {
    steps.push({
      name: "Twilio configuration",
      ok: false,
      detail:
        "No public URL configured. Set it in Admin → Integrations → Twilio.",
    });
    return { ready: false, steps };
  }
  steps.push({
    name: "Twilio configuration",
    ok: true,
    detail: `Public URL: ${publicUrl}`,
  });

  // Never downgrade: proxy when Caddy is up (web access on), else the server.
  const { port, target } = await desiredTunnelPort();
  const tunnelStep = await ensureTunnel(publicUrl, port);
  tunnelStep.detail += target === "proxy" ? " (proxy — dashboard public)" : " (server direct — dashboard local-only)";
  steps.push(tunnelStep);
  if (!tunnelStep.ok) return { ready: false, steps };

  const healthy = await checkPublicHealth(publicUrl);
  steps.push({
    name: "Public health check",
    ok: healthy,
    detail: healthy
      ? `${publicUrl}/health responds`
      : `Server not reachable at ${publicUrl}/health — is the API server running on port ${serverPort()}${target === "proxy" ? ` (via proxy :${port})` : ""}?`,
  });
  if (!healthy) return { ready: false, steps };

  if (!accountSid || !authToken) {
    steps.push({
      name: "Twilio webhooks",
      ok: false,
      skipped: true,
      detail:
        "Twilio credentials not configured — set them in Admin → Integrations → Twilio.",
    });
    return { ready: false, steps };
  }
  const webhookStep = await syncWebhooks(accountSid, authToken, publicUrl);
  steps.push(webhookStep);

  return { ready: steps.every((s) => s.ok), steps };
}

/** Current state of the phone system, without changing anything. */
export async function getPhoneSystemStatus(): Promise<PhoneSystemStatus> {
  const { accountSid, authToken, publicUrl } = await getTwilioConfig();
  const port = serverPort();
  const ports = { server: port, proxy: proxyPort() };
  const configured = Boolean(accountSid && authToken && publicUrl);
  const proxyUp = await isProxyUp();

  let tunnelRunning = false;
  let forwardsTo: string | null = null;
  let tunnelCorrect = false;
  let target: TunnelTarget | null = null;
  if (publicUrl) {
    const tunnels = await listNgrokTunnels();
    const tunnel = tunnels ? tunnelForDomain(tunnels, publicUrl) : null;
    if (tunnel) {
      tunnelRunning = true;
      forwardsTo = tunnel.config.addr;
      target = classifyTunnelTarget(tunnel.config.addr, ports);
      tunnelCorrect = target !== "other";
    }
  }

  const publicHealthOk =
    publicUrl && tunnelRunning
      ? await fetchWithTimeout(`${publicUrl}/health`, {}, 3000)
          .then((r) => r.ok)
          .catch(() => false)
      : false;

  const numbers: PhoneNumberStatus[] = [];
  const properties = await realNumbers();
  if (properties.length > 0 && accountSid && authToken && publicUrl) {
    const twilio = (await import("twilio")).default;
    const client = twilio(accountSid, authToken);
    for (const property of properties) {
      let webhooksOk: boolean | null = null;
      try {
        const num = await client
          .incomingPhoneNumbers(property.twilioPhoneSid!)
          .fetch();
        webhooksOk =
          num.voiceUrl === `${publicUrl}${WEBHOOK_PATHS.voice}` &&
          num.smsUrl === `${publicUrl}${WEBHOOK_PATHS.sms}`;
      } catch {
        webhooksOk = null;
      }
      numbers.push({
        propertyId: property.id,
        propertyName: property.name,
        phone: property.twilioPhone!,
        webhooksOk,
      });
    }
  } else {
    for (const property of properties) {
      numbers.push({
        propertyId: property.id,
        propertyName: property.name,
        phone: property.twilioPhone!,
        webhooksOk: null,
      });
    }
  }

  return {
    configured,
    publicUrl,
    serverPort: port,
    proxyPort: ports.proxy,
    proxyUp,
    tunnel: { running: tunnelRunning, forwardsTo, correct: tunnelCorrect, target },
    webPublic: tunnelRunning && target === "proxy",
    publicHealthOk,
    numbers,
    ready:
      configured &&
      tunnelRunning &&
      tunnelCorrect &&
      publicHealthOk &&
      numbers.length > 0 &&
      numbers.every((n) => n.webhooksOk === true),
  };
}
