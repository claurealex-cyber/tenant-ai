"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DashboardShell from "@/components/layout/DashboardShell";

interface SmsLeadRow {
  key: string;
  phone: string;
  name: string | null;
  propertyName: string;
  firstContactAt: string | null;
  origins: string[];
  linkKind: string;
  callerMessage?: string | null;
  delivery: { status: string; sentAt: string | null; lastError: string | null } | null;
  state: string;
  isTenant: boolean;
  inboundMessage: string | null;
  transcript: Array<{ role: string; content: string }> | null;
}

interface Counts {
  total: number;
  textedIn: number;
  zillow: number;
  called: number;
  googleForm: number;
  hosted: number;
  applied: number;
  optedOut: number;
  tenants: number;
}

const PAGE_SIZE = 50;

const LINK_LABEL: Record<string, string> = {
  google_form: "Google Form",
  hosted: "Hosted survey (ngrok)",
  none: "none yet",
};
const LINK_STYLE: Record<string, string> = {
  google_form: "bg-purple-50 text-purple-700",
  hosted: "bg-blue-50 text-blue-700",
  none: "bg-gray-100 text-gray-500",
};
const STATE_STYLE: Record<string, string> = {
  applied: "bg-green-50 text-green-700",
  invited: "bg-amber-50 text-amber-700",
  contacted: "bg-blue-50 text-blue-700",
  opted_out: "bg-gray-100 text-gray-500",
};

export default function SmsLeadsPage() {
  const [rows, setRows] = useState<SmsLeadRow[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [origin, setOrigin] = useState("");
  const [linkKind, setLinkKind] = useState("");
  const [state, setState] = useState("");
  const [includeTenants, setIncludeTenants] = useState(false);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [pollPaused, setPollPaused] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams();
      if (origin) params.set("origin", origin);
      if (linkKind) params.set("linkKind", linkKind);
      if (state) params.set("state", state);
      if (includeTenants) params.set("includeTenants", "true");
      const res = await fetch(`/api/admin/sms-leads?${params}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setRows(data.rows || []);
      setCounts(data.counts || null);
      setError("");
      setLastRefreshed(new Date());
      return true;
    } catch {
      setError("Failed to load SMS leads");
      return false;
    } finally {
      if (!silent) setLoading(false);
    }
  }, [origin, linkKind, state, includeTenants]);

  useEffect(() => {
    setPage(0);
    load();
  }, [load]);

  // Visibility-gated auto-refresh (~2 min). SMS-leads payload is tiny; still
  // pause when hidden and stop after repeated failures to respect the ngrok
  // Free quota. Silent (no spinner) so the table doesn't flash.
  useEffect(() => {
    let stopped = false, failures = 0;
    let interval: ReturnType<typeof setInterval> | null = null;
    const tick = async () => {
      if (stopped) return;
      const ok = await load(true);
      failures = ok ? 0 : failures + 1;
      if (failures >= 3) { stopped = true; setPollPaused(true); if (interval) clearInterval(interval); }
    };
    const start = () => { if (!interval && !stopped) interval = setInterval(tick, 120_000); };
    const stop = () => { if (interval) clearInterval(interval); interval = null; };
    const onVis = () => {
      if (document.visibilityState === "visible") { if (!stopped) { tick(); start(); } }
      else stop();
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVis);
    return () => { stopped = true; stop(); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);

  const pageRows = useMemo(() => rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [rows, page]);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

  return (
    <DashboardShell>
      <div className="mx-auto max-w-6xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">SMS Leads</h1>
          <p className="mt-1 text-sm text-gray-500">
            Everyone who texted the property number or was sent a survey link — and which link
            they received (Google Form or the hosted survey).
          </p>
        </div>

        {error && <div className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

        <div className="mb-2 flex items-center gap-3 text-xs text-gray-500">
          {lastRefreshed && <span>updated {lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
          {pollPaused && <span className="text-amber-600">· auto-refresh paused (reload to resume)</span>}
          <button onClick={() => load()} className="text-blue-600 hover:underline">refresh now</button>
        </div>
        {counts && (
          <div className="mb-4 rounded-lg border border-gray-200 bg-white p-6">
            <dl className="grid grid-cols-3 gap-4 sm:grid-cols-7">
              {[
                ["Leads", counts.total],
                ["Texted in", counts.textedIn],
                ["Called + texted link", counts.called],
                ["From Zillow", counts.zillow],
                ["Got Google Form", counts.googleForm],
                ["Got hosted survey", counts.hosted],
                ["Applied", counts.applied],
                ["Opted out", counts.optedOut],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-gray-500">{label}</dt>
                  <dd className="mt-1 text-lg font-semibold text-gray-900">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
          <select value={origin} onChange={(e) => setOrigin(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1.5">
            <option value="">All origins</option>
            <option value="texted_in">Texted in</option>
            <option value="called">Called</option>
            <option value="zillow">Zillow</option>
          </select>
          <select value={linkKind} onChange={(e) => setLinkKind(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1.5">
            <option value="">All link kinds</option>
            <option value="google_form">Google Form</option>
            <option value="hosted">Hosted survey (ngrok)</option>
            <option value="none">No link yet</option>
          </select>
          <select value={state} onChange={(e) => setState(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1.5">
            <option value="">All states</option>
            <option value="invited">Invited</option>
            <option value="applied">Applied</option>
            <option value="contacted">Contacted</option>
            <option value="opted_out">Opted out</option>
          </select>
          <label className="flex items-center gap-1.5 text-gray-600">
            <input type="checkbox" checked={includeTenants} onChange={(e) => setIncludeTenants(e.target.checked)} />
            Show tenants
          </label>
          <span className="text-xs text-gray-500">{rows.length} {rows.length === 1 ? "row" : "rows"}</span>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Phone</th>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Property</th>
                    <th className="px-4 py-3">First contact</th>
                    <th className="px-4 py-3">Origin</th>
                    <th className="px-4 py-3">Link sent</th>
                    <th className="px-4 py-3">Delivery</th>
                    <th className="px-4 py-3">State</th>
                    <th className="px-4 py-3">Their message</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pageRows.map((row) => (
                    <>
                      <tr
                        key={row.key}
                        className={`${row.state === "opted_out" ? "opacity-50" : ""} ${row.transcript ? "cursor-pointer hover:bg-gray-50" : ""}`}
                        onClick={() => row.transcript && setExpanded(expanded === row.key ? null : row.key)}
                      >
                        <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-900">{row.phone}</td>
                        <td className="px-4 py-3 text-gray-600">
                          {row.name ?? "—"}
                          {row.isTenant && (
                            <span className="ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">tenant</span>
                          )}
                        </td>
                        <td className="max-w-[140px] truncate px-4 py-3 text-gray-600">{row.propertyName}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                          {row.firstContactAt ? new Date(row.firstContactAt).toLocaleDateString() : "—"}
                        </td>
                        <td className="px-4 py-3">
                          {row.origins.map((o) => (
                            <span
                              key={o}
                              className={`mr-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                                o === "called" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
                              }`}
                            >
                              {o === "texted_in" ? "texted in" : o === "called" ? "📞 called" : "Zillow"}
                            </span>
                          ))}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${LINK_STYLE[row.linkKind] ?? ""}`}>
                            {LINK_LABEL[row.linkKind] ?? row.linkKind}
                          </span>
                          {row.callerMessage && (
                            <span className="ml-1 cursor-help text-blue-500" title={row.callerMessage}>
                              ⓘ
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600">
                          {row.delivery
                            ? row.delivery.status === "sent"
                              ? `sent ${row.delivery.sentAt ? new Date(row.delivery.sentAt).toLocaleDateString() : ""}`
                              : row.delivery.status === "deferred"
                                ? "queued"
                                : row.delivery.status
                            : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATE_STYLE[row.state] ?? ""}`}>
                            {row.state.replace("_", " ")}
                          </span>
                        </td>
                        <td className="max-w-[220px] truncate px-4 py-3 text-xs text-gray-500" title={row.inboundMessage ?? ""}>
                          {row.inboundMessage ?? "—"}
                          {row.transcript && <span className="ml-1 text-blue-500">▾</span>}
                        </td>
                      </tr>
                      {expanded === row.key && row.transcript && (
                        <tr key={`${row.key}-transcript`}>
                          <td colSpan={9} className="bg-gray-50 px-6 py-3">
                            <p className="mb-2 text-xs font-medium text-gray-500">
                              Conversation (full transcript available for 24h after last activity)
                            </p>
                            <div className="space-y-1">
                              {row.transcript.map((m, i) => (
                                <p key={i} className="text-xs">
                                  <span className={`font-semibold ${m.role === "user" ? "text-blue-700" : "text-gray-500"}`}>
                                    {m.role === "user" ? "Them" : "Auto-reply"}:
                                  </span>{" "}
                                  <span className="text-gray-700">{m.content}</span>
                                </p>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                  {pageRows.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-sm text-gray-500">
                        No leads match these filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {pageCount > 1 && (
              <div className="mt-4 flex items-center justify-between text-sm">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="rounded-md border border-gray-300 px-3 py-1.5 disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="text-gray-500">Page {page + 1} of {pageCount}</span>
                <button
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  disabled={page >= pageCount - 1}
                  className="rounded-md border border-gray-300 px-3 py-1.5 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </DashboardShell>
  );
}
