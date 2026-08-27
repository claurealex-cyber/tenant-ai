"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import AutomationPanel from "./AutomationPanel";

interface ZillowLead {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  propertyText: string;
  firstContactAt: string | null;
  zillowStatus: string | null;
  lastMessage: string | null;
  status: string;
  sendError: string | null;
  delivery: { status: string; lastError: string | null; sentAt: string | null; body?: string | null; kind?: string | null } | null;
}

interface ImportRun {
  id: string;
  status: string;
  leadsFound: number;
  leadsNew: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  new: "bg-blue-50 text-blue-700",
  invited: "bg-amber-50 text-amber-700",
  applied: "bg-green-50 text-green-700",
  opted_out: "bg-gray-100 text-gray-500",
  no_phone: "bg-gray-100 text-gray-500",
};

const PAGE_SIZE = 50;

export default function ZillowLeadsPage() {
  const [leads, setLeads] = useState<ZillowLead[]>([]);
  const [runs, setRuns] = useState<ImportRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [batchSending, setBatchSending] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [page, setPage] = useState(0);
  const [confirmBatch, setConfirmBatch] = useState(false);
  const [autoInfo, setAutoInfo] = useState<{ enabled: boolean; startHour?: number; endHour?: number; runHours?: number[] | null; nextRunLabel?: string | null } | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [pollPaused, setPollPaused] = useState(false);

  const load = useCallback(async () => {
    try {
      const [leadsRes, runsRes] = await Promise.all([
        fetch("/api/admin/zillow/leads"),
        fetch("/api/admin/zillow/runs"),
      ]);
      if (leadsRes.ok) setLeads((await leadsRes.json()).leads || []);
      if (runsRes.ok) setRuns((await runsRes.json()).runs || []);
      setLastRefreshed(new Date());
    } catch {
      setBanner({ kind: "err", text: "Failed to load Zillow leads" });
    } finally {
      setLoading(false);
    }
  }, []);

  // Visibility-gated auto-refresh: poll the SMALL auto-status every 2 min; only
  // refetch the (large) lead list when the automation's lead total / last run
  // changed. Pauses when the tab is hidden and stops after repeated failures —
  // every request is metered on the ngrok Free quota.
  useEffect(() => {
    let stopped = false, failures = 0, sig = "";
    let interval: ReturnType<typeof setInterval> | null = null;
    const tick = async () => {
      if (stopped) return;
      try {
        const res = await fetch("/api/admin/zillow/auto-status", { cache: "no-store" });
        if (!res.ok) throw new Error("status");
        const st = await res.json();
        setAutoInfo({ enabled: st.enabled, startHour: st.startHour, endHour: st.endHour, runHours: st.runHours, nextRunLabel: st.nextRunLabel });
        const newSig = `${st.totals?.leads}|${st.today?.status}|${st.today?.leadsNew}|${st.today?.sentImmediate}`;
        if (sig && newSig !== sig) await load(); // automation did something → refresh the list
        sig = newSig;
        failures = 0;
        setPollPaused(false);
      } catch {
        if (++failures >= 3) { stopped = true; setPollPaused(true); if (interval) clearInterval(interval); }
      }
    };
    const start = () => { if (!interval && !stopped) interval = setInterval(tick, 120_000); };
    const stop = () => { if (interval) clearInterval(interval); interval = null; };
    const onVis = () => {
      if (document.visibilityState === "visible") { if (!stopped) { tick(); start(); } }
      else stop();
    };
    tick();
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVis);
    return () => { stopped = true; stop(); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);

  useEffect(() => {
    load();
  }, [load]);

  const runImport = async () => {
    setImporting(true);
    setBanner(null);
    try {
      const res = await fetch("/api/admin/zillow/import", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.status === "done") {
        setBanner({ kind: "ok", text: `Import complete: ${data.leadsFound} leads found, ${data.leadsNew} new.` });
      } else {
        const detail = data.error || "Import failed";
        setBanner({
          kind: "err",
          text: detail.includes("needs-login")
            ? "Zillow session expired — open Safari, sign into Zillow Rental Manager, then retry."
            : detail,
        });
      }
      await load();
    } catch {
      setBanner({ kind: "err", text: "Import failed — could not reach the API server." });
    } finally {
      setImporting(false);
    }
  };

  const sendOne = async (leadId: string, manual = false) => {
    setSendingId(leadId);
    setBanner(null);
    try {
      const res = await fetch("/api/admin/zillow/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, manual }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.result === "sent") setBanner({ kind: "ok", text: "Application link sent." });
      else if (data.result === "deferred")
        setBanner({
          kind: "ok",
          text: data.detail
            ? `Cap reached — queued. ${data.detail}. It sends automatically then; you can also retry after that time.`
            : "Queued — the relay caps are pacing sends; it goes out automatically.",
        });
      else setBanner({ kind: "err", text: `Not sent: ${data.detail || data.result}` });
      await load();
    } catch {
      setBanner({ kind: "err", text: "Send failed — could not reach the API server." });
    } finally {
      setSendingId(null);
    }
  };

  const sendBatch = async () => {
    setConfirmBatch(false);
    setBatchSending(true);
    setBanner(null);
    try {
      const res = await fetch("/api/admin/zillow/send-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setBanner({
          kind: "ok",
          text: `Batch queued: ${data.sent} sent now, ${data.deferred} queued behind the caps, ${data.skipped} skipped, ${data.failed} failed. Queued texts go out automatically over the coming days.`,
        });
      } else {
        setBanner({ kind: "err", text: data.error || "Batch failed" });
      }
      await load();
    } catch {
      setBanner({ kind: "err", text: "Batch failed — could not reach the API server." });
    } finally {
      setBatchSending(false);
    }
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of leads) c[l.status] = (c[l.status] ?? 0) + 1;
    return c;
  }, [leads]);

  const sendable = counts["new"] ?? 0;
  const estDays = Math.max(1, Math.ceil(sendable / 25));

  const filtered = useMemo(
    () =>
      statusFilter === "__link_sent"
        ? leads.filter((l) => l.delivery?.status === "sent")
        : statusFilter
          ? leads.filter((l) => l.status === statusFilter)
          : leads,
    [leads, statusFilter],
  );
  const pageLeads = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  const lastRun = runs[0];

  return (
    <DashboardShell>
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Zillow Leads</h1>
            <p className="mt-1 text-sm text-gray-500">
              Imports inquiries from Zillow Rental Manager (via the signed-in Safari session) and
              texts each lead the rental-application survey link.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={runImport}
              disabled={importing}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {importing ? "Importing…" : "Import from Zillow"}
            </button>
            <a
              href="/api/admin/zillow/csv"
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Download CSV
            </a>
            <button
              onClick={() => setConfirmBatch(true)}
              disabled={batchSending || sendable === 0}
              className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {batchSending ? "Queueing…" : `Send survey to all new (${sendable})`}
            </button>
          </div>
        </div>

        <div className="mb-6">
          <AutomationPanel newLeadCount={counts["new"] ?? 0} />
        </div>

        {banner && (
          <div
            className={`mb-4 rounded-md px-4 py-3 text-sm ${
              banner.kind === "ok" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"
            }`}
          >
            {banner.text}
          </div>
        )}

        {confirmBatch && (
          <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-medium">Queue the survey text for {sendable} leads?</p>
            <p className="mt-1">
              Sends go out from the personal number and are deliberately paced to protect it from
              carrier spam-flagging: about 3 per hour, 25 per day — roughly {estDays}{" "}
              {estDays === 1 ? "day" : "days"} for this batch. Leads older than 60 days are skipped.
              Everything is queued now and drains automatically; opted-out numbers are never texted.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={sendBatch}
                className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
              >
                Queue the batch
              </button>
              <button
                onClick={() => setConfirmBatch(false)}
                className="rounded-md border border-amber-300 px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Stats + last run */}
            <div className="rounded-lg border border-gray-200 bg-white p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <dl className="grid grid-cols-3 gap-6 sm:grid-cols-6">
                  {[
                    ["Total", leads.length],
                    ["New", counts["new"] ?? 0],
                    ["Invited", counts["invited"] ?? 0],
                    ["Applied", counts["applied"] ?? 0],
                    ["Opted out", counts["opted_out"] ?? 0],
                    ["No phone", counts["no_phone"] ?? 0],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-xs text-gray-500">{label}</dt>
                      <dd className="mt-1 text-lg font-semibold text-gray-900">{value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="text-xs text-gray-500">
                  {lastRun ? (
                    <>
                      Last import: {new Date(lastRun.startedAt).toLocaleString()} —{" "}
                      {lastRun.status === "done" ? (
                        <span className="text-green-700">
                          {lastRun.leadsFound} found, {lastRun.leadsNew} new
                        </span>
                      ) : lastRun.status === "failed" ? (
                        <span className="text-red-700">failed: {lastRun.error}</span>
                      ) : (
                        "running…"
                      )}
                    </>
                  ) : (
                    "No imports yet"
                  )}
                </div>
              </div>
            </div>

            {/* Filter */}
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600">Filter:</label>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(0);
                }}
                className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="">All statuses</option>
                <option value="__link_sent">Link sent ✓</option>
                <option value="new">New</option>
                <option value="invited">Invited</option>
                <option value="applied">Applied</option>
                <option value="opted_out">Opted out</option>
                <option value="no_phone">No phone</option>
              </select>
              <span className="text-xs text-gray-500">
                {filtered.length} {filtered.length === 1 ? "lead" : "leads"}
              </span>
            </div>

            {/* Automation status line */}
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
              {autoInfo && (
                <span>
                  Automation:{" "}
                  <span className={autoInfo.enabled ? "font-medium text-green-700" : "text-gray-500"}>
                    {autoInfo.enabled ? "ON" : "OFF"}
                  </span>
                  {autoInfo.enabled && (
                    <>
                      {" "}· {autoInfo.runHours && autoInfo.runHours.length
                        ? `${autoInfo.runHours.length}×/day ${autoInfo.runHours.map((h) => `${String(h).padStart(2, "0")}:00`).join(", ")}`
                        : `hourly ${autoInfo.startHour ?? 8}:00–${autoInfo.endHour ?? 22}:00`}
                      {autoInfo.nextRunLabel ? ` · next run ${autoInfo.nextRunLabel}` : ""}
                    </>
                  )}
                </span>
              )}
              {lastRefreshed && (
                <span>· updated {lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              )}
              {pollPaused && <span className="text-amber-600">· auto-refresh paused (reload to resume)</span>}
              <button onClick={() => load()} className="text-blue-600 hover:underline">refresh now</button>
            </div>

            {/* Table */}
            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Phone</th>
                    <th className="px-4 py-3">Listing</th>
                    <th className="px-4 py-3">First contact</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Delivery</th>
                    <th className="px-4 py-3">Message</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pageLeads.map((lead) => (
                    <tr key={lead.id} className={lead.status === "opted_out" ? "opacity-50" : ""}>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        <div className="flex items-center gap-2">
                          {lead.phone && lead.status !== "opted_out" && (
                            <button
                              onClick={() => sendOne(lead.id, lead.status !== "new")}
                              disabled={sendingId === lead.id}
                              title={
                                lead.status === "new"
                                  ? "Text this lead the application link"
                                  : "Re-text the application link (manual retry — skips the cooldown)"
                              }
                              className="shrink-0 rounded-md border border-green-600 px-2 py-0.5 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-50"
                            >
                              {sendingId === lead.id
                                ? "…"
                                : lead.status === "new"
                                  ? "Send link"
                                  : lead.status === "invited"
                                    ? "Resend"
                                    : "Retry"}
                            </button>
                          )}
                          <span>{lead.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{lead.phone ?? "—"}</td>
                      <td className="max-w-[180px] truncate px-4 py-3 text-gray-600" title={lead.propertyText}>
                        {lead.propertyText || "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                        {lead.firstContactAt ? new Date(lead.firstContactAt).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[lead.status] ?? "bg-gray-100 text-gray-600"}`}
                        >
                          {lead.status.replace("_", " ")}
                        </span>
                        {lead.sendError && (
                          <div className="mt-1 text-xs text-red-600" title={lead.sendError}>
                            {lead.sendError}
                          </div>
                        )}
                      </td>
                      <td
                        className="px-4 py-3 text-xs text-gray-600"
                        title={lead.delivery?.body ?? ""}
                      >
                        {lead.delivery
                          ? lead.delivery.status === "sent"
                            ? `link sent ${lead.delivery.sentAt ? new Date(lead.delivery.sentAt).toLocaleDateString() : ""}`
                            : lead.delivery.status === "deferred"
                              ? "queued"
                              : `${lead.delivery.status}${lead.delivery.lastError ? `: ${lead.delivery.lastError}` : ""}`
                          : "—"}
                        {lead.delivery?.body && (
                          <span className="ml-1 cursor-help text-blue-500" title={lead.delivery.body}>
                            ⓘ
                          </span>
                        )}
                      </td>
                      <td className="max-w-[220px] truncate px-4 py-3 text-xs text-gray-500" title={lead.lastMessage ?? ""}>
                        {lead.lastMessage ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {lead.status === "new" && lead.phone && (
                          <button
                            onClick={() => sendOne(lead.id)}
                            disabled={sendingId === lead.id}
                            className="rounded-md border border-green-600 px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-50"
                          >
                            {sendingId === lead.id ? "Sending…" : "Send survey"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {pageLeads.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-500">
                        No leads{statusFilter ? " with this status" : " yet — run an import"}.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {pageCount > 1 && (
              <div className="flex items-center justify-between text-sm">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="rounded-md border border-gray-300 px-3 py-1.5 disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="text-gray-500">
                  Page {page + 1} of {pageCount}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  disabled={page >= pageCount - 1}
                  className="rounded-md border border-gray-300 px-3 py-1.5 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
