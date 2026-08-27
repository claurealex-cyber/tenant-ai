"use client";

import { useState, useEffect, useCallback } from "react";
import DashboardShell from "@/components/layout/DashboardShell";

interface PhoneSystemStep {
  name: string;
  ok: boolean;
  skipped?: boolean;
  detail: string;
}

interface PhoneSystemStatus {
  configured: boolean;
  publicUrl: string | null;
  serverPort: number;
  proxyPort: number;
  proxyUp: boolean;
  tunnel: {
    running: boolean;
    forwardsTo: string | null;
    correct: boolean;
    target: "proxy" | "server" | "other" | null;
  };
  webPublic: boolean;
  publicHealthOk: boolean;
  numbers: Array<{
    propertyId: string;
    propertyName: string;
    phone: string;
    webhooksOk: boolean | null;
  }>;
  ready: boolean;
}

interface HealthData {
  status: string;
  activeCalls?: number;
  maxCalls?: number;
  memoryUsage?: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
  };
  uptime?: number;
  database?: string;
  version?: string;
  dbConnected?: boolean;
  redisConnected?: boolean;
  lastJobRuns?: Array<{ name: string; lastRun: string | null; error: string | null }>;
  recentErrorCount?: number;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);
  return parts.join(" ");
}

function formatMB(bytes: number): string {
  return (bytes / 1024 / 1024).toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

// Every request through ngrok is metered (Free plan: 20k/month shared with the
// phone webhooks). Poll slowly, never while the tab is hidden, and stop after
// repeated failures — a forgotten background tab must cost zero requests.
// Rule for this dashboard: no poller without a visibility gate.
const HEALTH_POLL_SECONDS = 120;
const HEALTH_MAX_FAILURES = 3;

export default function AdminSystemPage() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(HEALTH_POLL_SECONDS);
  const [pollPaused, setPollPaused] = useState<"" | "hidden" | "failures">("");
  const [webToggling, setWebToggling] = useState(false);
  const [webSteps, setWebSteps] = useState<PhoneSystemStep[] | null>(null);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [phoneStatus, setPhoneStatus] = useState<PhoneSystemStatus | null>(null);
  const [phoneLoading, setPhoneLoading] = useState(true);
  const [phoneStarting, setPhoneStarting] = useState(false);
  const [phoneSteps, setPhoneSteps] = useState<PhoneSystemStep[] | null>(null);
  const [phoneError, setPhoneError] = useState("");

  const [healthTarget, setHealthTarget] = useState("");

  const fetchHealth = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/admin/server-health", {
        cache: "no-store",
      });
      if (!res.ok) {
        setError("Server returned an error response.");
        setHealth(null);
        return false;
      }
      const data = await res.json();
      if (data.target) setHealthTarget(data.target);
      if (!data.ok) {
        setError("Unable to reach the server. It may be down or unreachable.");
        setHealth(null);
        return false;
      }
      setHealth(data.health);
      setError("");
      setLastRefresh(new Date());
      return true;
    } catch {
      setError("Unable to reach the server. It may be down or unreachable.");
      setHealth(null);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const setWebAccess = async (on: boolean) => {
    setWebToggling(true);
    setWebSteps(null);
    setPhoneError("");
    try {
      const res = await fetch("/api/admin/phone-system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: on ? "web-on" : "web-off" }),
      });
      if (!res.ok) {
        setPhoneError("Failed to change web access.");
        return;
      }
      const data = await res.json();
      setWebSteps(data.steps);
      await fetchPhoneStatus();
    } catch {
      setPhoneError("Failed to change web access.");
    } finally {
      setWebToggling(false);
    }
  };

  const fetchPhoneStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/phone-system", { cache: "no-store" });
      if (!res.ok) {
        setPhoneError("Unable to load phone system status.");
        setPhoneStatus(null);
        return;
      }
      const data = await res.json();
      setPhoneStatus(data.status);
      setPhoneError("");
    } catch {
      setPhoneError("Unable to load phone system status.");
      setPhoneStatus(null);
    } finally {
      setPhoneLoading(false);
    }
  }, []);

  const startPhoneSystem = async () => {
    setPhoneStarting(true);
    setPhoneSteps(null);
    setPhoneError("");
    try {
      const res = await fetch("/api/admin/phone-system", { method: "POST" });
      if (!res.ok) {
        setPhoneError("Failed to start the phone system.");
        return;
      }
      const data = await res.json();
      setPhoneSteps(data.steps);
      await fetchPhoneStatus();
    } catch {
      setPhoneError("Failed to start the phone system.");
    } finally {
      setPhoneStarting(false);
    }
  };

  useEffect(() => {
    fetchPhoneStatus();
  }, [fetchPhoneStatus]);

  useEffect(() => {
    let failures = 0;
    let stopped = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      if (stopped) return;
      const ok = await fetchHealth();
      failures = ok ? 0 : failures + 1;
      setCountdown(HEALTH_POLL_SECONDS);
      if (failures >= HEALTH_MAX_FAILURES) {
        stop("failures");
      }
    };
    const start = () => {
      if (interval || stopped) return;
      setPollPaused("");
      interval = setInterval(poll, HEALTH_POLL_SECONDS * 1000);
    };
    const stop = (why: "hidden" | "failures") => {
      if (interval) clearInterval(interval);
      interval = null;
      if (why === "failures") stopped = true;
      setPollPaused(why);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        if (!stopped) {
          poll(); // one refresh on return, then resume the slow cadence
          start();
        }
      } else {
        stop("hidden");
      }
    };

    poll();
    if (document.visibilityState === "visible") start();
    else setPollPaused("hidden");
    document.addEventListener("visibilitychange", onVisibility);

    const tick = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => {
      stopped = true;
      if (interval) clearInterval(interval);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fetchHealth]);

  return (
    <DashboardShell>
      <div className="px-6 py-8 lg:px-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">System Health</h1>
            <p className="mt-1 text-sm text-gray-500">
              Server status and resource monitoring. Auto-refreshes every {HEALTH_POLL_SECONDS / 60} minutes while this tab is visible.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {lastRefresh && (
              <span className="text-xs text-gray-400">
                Last updated: {lastRefresh.toLocaleTimeString()}
              </span>
            )}
            <span className="text-xs text-gray-400">
              {pollPaused === "hidden"
                ? "Auto-refresh paused (tab hidden)"
                : pollPaused === "failures"
                  ? "Auto-refresh stopped after repeated failures — reload to resume"
                  : `Next refresh in ${countdown}s`}
            </span>
            <button
              onClick={() => {
                setLoading(true);
                setCountdown(30);
                fetchHealth();
              }}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Phone System */}
        <div className="mb-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Phone System</h2>
              <p className="mt-1 text-sm text-gray-500">
                Tunnel and Twilio webhooks that route calls and texts to the AI agent.
              </p>
            </div>
            <div className="flex items-center gap-3">
              {phoneStatus && (
                <span
                  className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${
                    phoneStatus.ready
                      ? "bg-green-100 text-green-700"
                      : "bg-yellow-100 text-yellow-700"
                  }`}
                >
                  {phoneStatus.ready ? "Ready for calls" : "Not ready"}
                </span>
              )}
              <button
                onClick={startPhoneSystem}
                disabled={phoneStarting}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {phoneStarting ? "Starting..." : "Start Phone System"}
              </button>
            </div>
          </div>

          {phoneError && (
            <p className="mt-3 text-sm text-red-600">{phoneError}</p>
          )}

          {phoneLoading ? (
            <p className="mt-3 text-sm text-gray-400">Checking phone system...</p>
          ) : phoneStatus ? (
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <p className="text-sm font-medium text-gray-500">Tunnel</p>
                <p className="mt-1 text-sm text-gray-900" data-testid="tunnel-target">
                  {phoneStatus.tunnel.running ? (
                    phoneStatus.tunnel.target === "proxy" ? (
                      <span className="text-green-700">
                        Running → proxy :{phoneStatus.proxyPort} (web access ON)
                      </span>
                    ) : phoneStatus.tunnel.target === "server" ? (
                      <span className="text-green-700">
                        Running → server :{phoneStatus.serverPort} (web access OFF
                        {phoneStatus.proxyUp ? "" : " — no proxy"})
                      </span>
                    ) : (
                      <span className="text-yellow-700">
                        Running but forwards to {phoneStatus.tunnel.forwardsTo} (expected
                        port {phoneStatus.proxyPort} or {phoneStatus.serverPort})
                      </span>
                    )
                  ) : (
                    <span className="text-gray-500">Not running</span>
                  )}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      phoneStatus.webPublic
                        ? "bg-green-100 text-green-700"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    Dashboard {phoneStatus.webPublic ? "public" : "local-only"}
                  </span>
                  {phoneStatus.tunnel.running && (
                    <button
                      onClick={() => {
                        if (
                          phoneStatus.webPublic &&
                          !window.confirm(
                            "Turn web access OFF?\n\nThe public URL will go straight to the API server: calls, texts and the hosted survey keep working, but THIS dashboard becomes unreachable from outside the Mac — including from this browser if you are remote.\n\nTo turn it back on: on the Mac run  ./start.sh web-on  (or relaunch Tenant AI from the Dock, which always restores it)."
                          )
                        ) {
                          return;
                        }
                        setWebAccess(!phoneStatus.webPublic);
                      }}
                      disabled={webToggling || (!phoneStatus.webPublic && !phoneStatus.proxyUp)}
                      title={
                        !phoneStatus.webPublic && !phoneStatus.proxyUp
                          ? "Caddy proxy is not running — relaunch Tenant AI to start it"
                          : phoneStatus.webPublic
                            ? "Point the domain at the server only (quota kill-switch)"
                            : "Point the domain at the proxy (dashboard reachable from anywhere)"
                      }
                      className="rounded border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      {webToggling ? "…" : phoneStatus.webPublic ? "Turn web access off" : "Turn web access on"}
                    </button>
                  )}
                </div>
                {webSteps && (
                  <ul className="mt-2 space-y-1">
                    {webSteps.map((step) => (
                      <li key={step.name} className={`text-xs ${step.ok ? "text-green-700" : "text-red-600"}`}>
                        {step.ok ? "✓" : "✗"} {step.detail}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-500">Public URL</p>
                <p className="mt-1 text-sm text-gray-900">
                  {phoneStatus.publicUrl || "Not configured"}
                  {phoneStatus.publicUrl && (
                    <span
                      className={`ml-2 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        phoneStatus.publicHealthOk
                          ? "bg-green-100 text-green-700"
                          : "bg-red-100 text-red-700"
                      }`}
                    >
                      {phoneStatus.publicHealthOk ? "reachable" : "unreachable"}
                    </span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-500">Numbers</p>
                {phoneStatus.numbers.length === 0 ? (
                  <p className="mt-1 text-sm text-gray-500">None provisioned</p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {phoneStatus.numbers.map((n) => (
                      <li key={n.propertyId} className="text-sm text-gray-900">
                        {n.phone}
                        <span className="ml-1 text-xs text-gray-400">
                          ({n.propertyName})
                        </span>
                        <span
                          className={`ml-2 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            n.webhooksOk === true
                              ? "bg-green-100 text-green-700"
                              : n.webhooksOk === false
                                ? "bg-yellow-100 text-yellow-700"
                                : "bg-gray-100 text-gray-500"
                          }`}
                        >
                          {n.webhooksOk === true
                            ? "webhooks ok"
                            : n.webhooksOk === false
                              ? "webhooks stale"
                              : "unchecked"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}

          {phoneSteps && (
            <div className="mt-4 rounded-lg bg-gray-50 p-4">
              <p className="mb-2 text-sm font-medium text-gray-700">Startup steps</p>
              <ul className="space-y-1">
                {phoneSteps.map((step) => (
                  <li key={step.name} className="flex items-start gap-2 text-sm">
                    <span
                      className={
                        step.ok
                          ? "text-green-600"
                          : step.skipped
                            ? "text-gray-400"
                            : "text-red-600"
                      }
                    >
                      {step.ok ? "✓" : step.skipped ? "–" : "✗"}
                    </span>
                    <span className="font-medium text-gray-900">{step.name}:</span>
                    <span className="text-gray-600">{step.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {loading && !health ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
              <p className="mt-3 text-sm text-gray-500">Checking server health...</p>
            </div>
          </div>
        ) : error ? (
          <div className="space-y-6">
            <div className="rounded-lg border-2 border-red-200 bg-red-50 p-8 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
                <svg
                  className="h-6 w-6 text-red-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-red-900">Server Unreachable</h3>
              <p className="mt-1 text-sm text-red-700">{error}</p>
              {healthTarget && (
                <p className="mt-2 text-xs text-red-500">
                  Target: {healthTarget}
                </p>
              )}
            </div>
          </div>
        ) : health ? (
          <div className="space-y-6">
            {/* Status Banner */}
            <div
              className={`rounded-lg border p-4 ${
                health.status === "ok"
                  ? "border-green-200 bg-green-50"
                  : "border-yellow-200 bg-yellow-50"
              }`}
            >
              <div className="flex items-center gap-2">
                <div
                  className={`h-3 w-3 rounded-full ${
                    health.status === "ok" ? "bg-green-500" : "bg-yellow-500"
                  }`}
                />
                <span
                  className={`text-sm font-medium ${
                    health.status === "ok" ? "text-green-800" : "text-yellow-800"
                  }`}
                >
                  Server is {health.status === "ok" ? "healthy" : health.status}
                </span>
                {health.version && (
                  <span className="text-xs text-gray-500">v{health.version}</span>
                )}
              </div>
            </div>

            {/* Metrics Cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <p className="text-sm font-medium text-gray-500">Active Calls</p>
                <p className="mt-1 text-2xl font-bold text-gray-900">
                  {health.activeCalls ?? 0}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <p className="text-sm font-medium text-gray-500">Memory Usage (RSS)</p>
                <p className="mt-1 text-2xl font-bold text-gray-900">
                  {health.memoryUsage
                    ? `${formatMB(health.memoryUsage.rss)} MB`
                    : "--"}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <p className="text-sm font-medium text-gray-500">Uptime</p>
                <p className="mt-1 text-2xl font-bold text-gray-900">
                  {health.uptime !== undefined ? formatUptime(health.uptime) : "--"}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <p className="text-sm font-medium text-gray-500">Database</p>
                <p className="mt-1 text-2xl font-bold text-gray-900">
                  <span
                    className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                      health.database === "connected"
                        ? "bg-green-100 text-green-700"
                        : "bg-red-100 text-red-700"
                    }`}
                  >
                    {health.database || "Unknown"}
                  </span>
                </p>
              </div>
            </div>

            {/* Memory Detail */}
            {health.memoryUsage && (
              <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                <h2 className="mb-4 text-lg font-semibold text-gray-900">
                  Memory Details
                </h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <p className="text-sm font-medium text-gray-500">RSS</p>
                    <p className="mt-1 text-lg font-semibold text-gray-900">
                      {formatMB(health.memoryUsage.rss)} MB
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-500">Heap Total</p>
                    <p className="mt-1 text-lg font-semibold text-gray-900">
                      {formatMB(health.memoryUsage.heapTotal)} MB
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-500">Heap Used</p>
                    <p className="mt-1 text-lg font-semibold text-gray-900">
                      {formatMB(health.memoryUsage.heapUsed)} MB
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-500">External</p>
                    <p className="mt-1 text-lg font-semibold text-gray-900">
                      {formatMB(health.memoryUsage.external)} MB
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Redis, Max Calls & Recent Errors */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <p className="text-sm font-medium text-gray-500">Redis</p>
                <p className="mt-1">
                  <span
                    className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                      health.redisConnected
                        ? "bg-green-100 text-green-700"
                        : "bg-red-100 text-red-700"
                    }`}
                  >
                    {health.redisConnected ? "connected" : "disconnected"}
                  </span>
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <p className="text-sm font-medium text-gray-500">Max Calls</p>
                <p className="mt-1 text-2xl font-bold text-gray-900">
                  {health.maxCalls ?? "--"}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <p className="text-sm font-medium text-gray-500">Recent Errors</p>
                <p className="mt-1">
                  <span
                    className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                      (health.recentErrorCount ?? 0) > 0
                        ? "bg-red-100 text-red-700"
                        : "bg-green-100 text-green-700"
                    }`}
                  >
                    {health.recentErrorCount ?? 0}
                  </span>
                </p>
              </div>
            </div>

            {/* Background Jobs */}
            {health.lastJobRuns && health.lastJobRuns.length > 0 && (
              <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                <h2 className="mb-4 text-lg font-semibold text-gray-900">Background Jobs</h2>
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="pb-3 text-left text-xs font-medium uppercase text-gray-500">Job</th>
                      <th className="pb-3 text-left text-xs font-medium uppercase text-gray-500">Last Run</th>
                      <th className="pb-3 text-left text-xs font-medium uppercase text-gray-500">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {health.lastJobRuns.map((job) => (
                      <tr
                        key={job.name}
                        className={job.error ? "cursor-pointer" : ""}
                        onClick={() => {
                          if (job.error) {
                            setExpandedJob(expandedJob === job.name ? null : job.name);
                          }
                        }}
                      >
                        <td className="py-3 text-sm font-medium text-gray-900">
                          {job.name}
                          {job.error && expandedJob === job.name && (
                            <div className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700 font-normal">
                              {job.error}
                            </div>
                          )}
                        </td>
                        <td className="py-3 text-sm text-gray-500">
                          {job.lastRun ? new Date(job.lastRun).toLocaleString() : "Never"}
                        </td>
                        <td className="py-3">
                          <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                            job.error ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
                          }`}>
                            {job.error ? "Error" : "OK"}
                          </span>
                          {job.error && (
                            <span className="ml-1 text-xs text-gray-400">
                              {expandedJob === job.name ? "[-]" : "[+]"}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </DashboardShell>
  );
}
