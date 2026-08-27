"use client";

import { useCallback, useEffect, useState } from "react";

/** Human cadence label: fixed 3×/day hours when configured, else the hourly window. */
function cadenceLabel(runHours?: number[] | null, startHour?: number, endHour?: number): string {
  if (runHours && runHours.length) {
    const hrs = runHours.map((h) => `${String(h).padStart(2, "0")}:00`).join(", ");
    return `${runHours.length}×/day at ${hrs}`;
  }
  return `hourly from ${startHour ?? 8}:00 to ${endHour ?? 22}:00`;
}

interface AutoRun {
  day: string;
  status: string;
  attempts: number;
  leadsFound: number;
  leadsNew: number;
  queuedSends: number;
  sentImmediate: number;
  error: string | null;
}

interface AutoStatus {
  enabled: boolean;
  autoHour: number;
  startHour?: number;
  endHour?: number;
  runHours?: number[] | null;
  nextRunLabel?: string | null;
  baseline: string | null;
  today: AutoRun | null;
  last30Days: AutoRun[];
  deferredQueue: { depth: number; oldestAgeDays: number | null };
  totals: { leads: number; numbersMessaged: number; applied: number };
  googleFormMode?: boolean;
}

const MILESTONES = [25, 50, 100, 200];

function StatusChip({ status }: { status: string }) {
  const styles: Record<string, string> = {
    done: "bg-green-50 text-green-700",
    running: "bg-blue-50 text-blue-700",
    needs_login: "bg-red-50 text-red-700",
    failed: "bg-red-50 text-red-700",
  };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] ?? "bg-gray-100 text-gray-600"}`}>
      {status.replace("_", " ")}
    </span>
  );
}

export default function AutomationPanel({ newLeadCount }: { newLeadCount: number }) {
  const [status, setStatus] = useState<AutoStatus | null>(null);
  const [confirmOn, setConfirmOn] = useState(false);
  const [baselineMode, setBaselineMode] = useState<"new" | "all">("new");
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/zillow/auto-status");
      if (res.ok) setStatus(await res.json());
    } catch {
      /* panel renders its unreachable state */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/zillow/auto-toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, baselineMode }),
      });
      if (res.ok) {
        setNote({
          kind: "ok",
          text: enabled
            ? "Automation is ON. The server picks the switch up within a minute; it runs " +
              `${cadenceLabel(status?.runHours, status?.startHour, status?.endHour)}.`
            : "Automation is OFF.",
        });
      } else {
        setNote({ kind: "err", text: "Toggle failed" });
      }
      setConfirmOn(false);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const runNow = async () => {
    setRunning(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/zillow/auto-run", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (data.outcome === "ran") {
        setNote({
          kind: "ok",
          text: `Run complete: ${data.run?.leadsNew ?? 0} new leads, ${data.run?.queuedSends ?? 0} survey texts queued.`,
        });
      } else if (data.outcome === "needs_login") {
        setNote({ kind: "err", text: "Zillow session expired — open Safari, sign into Zillow Rental Manager, then run again." });
      } else {
        setNote({ kind: "err", text: `Run result: ${data.outcome}${data.run?.error ? ` — ${data.run.error}` : ""}` });
      }
      await load();
    } catch {
      setNote({ kind: "err", text: "Could not reach the API server." });
    } finally {
      setRunning(false);
    }
  };

  if (!status) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-500">
        Automation status unavailable — is the API server running?
      </div>
    );
  }

  const today = status.today;
  const messaged = status.totals.numbersMessaged;
  const nextMilestone = MILESTONES.find((m) => m > messaged);

  return (
    <div className="space-y-3">
      {/* Needs-attention banner */}
      {today?.status === "needs_login" && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span className="font-semibold">Zillow session expired.</span> Open Safari and sign into
          Zillow Rental Manager — the automation retries hourly and will pick itself up, or use
          Run now.
        </div>
      )}
      {today?.status === "failed" && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span className="font-semibold">Today&apos;s run failed:</span> {today.error ?? "unknown error"} — it
          retries hourly.
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Daily automation</h2>
            <p className="mt-1 text-xs text-gray-500">
              Imports new Zillow leads {cadenceLabel(status.runHours, status.startHour, status.endHour)}
              {" "}and texts each NEW one the application link.
              {status.enabled && status.nextRunLabel ? ` Next run: ${status.nextRunLabel}.` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {status.enabled ? (
              <button
                onClick={() => toggle(false)}
                disabled={busy}
                className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                title="Click to turn off"
              >
                Automation: RUNNING — turn off
              </button>
            ) : (
              <button
                onClick={() => setConfirmOn(true)}
                disabled={busy}
                className="rounded-md bg-gray-700 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
              >
                Automation: OFF — turn on
              </button>
            )}
            <button
              onClick={runNow}
              disabled={running}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {running ? "Running…" : "Run now"}
            </button>
          </div>
        </div>

        {note && (
          <div
            className={`mt-3 rounded-md px-3 py-2 text-sm ${note.kind === "ok" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}
          >
            {note.text}
          </div>
        )}

        {confirmOn && (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-medium">Turn on daily automation?</p>
            <p className="mt-1">
              Every day it will import new Zillow leads and queue each one a survey text from the
              personal number, paced by the send caps (~3/hour, 25/day, STOP always honored).
            </p>
            <div className="mt-2 space-y-1">
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  checked={baselineMode === "new"}
                  onChange={() => setBaselineMode("new")}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">Only new leads from now on</span> (recommended) — the{" "}
                  <span className="font-medium">{newLeadCount} leads already in your list will NOT be messaged</span>.
                  Only leads a future scrape adds get texted. (You can still text existing leads by hand.)
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  checked={baselineMode === "all"}
                  onChange={() => setBaselineMode("all")}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">Include the existing backlog</span> — also text the{" "}
                  <span className="font-medium">{newLeadCount} leads already in your list</span>{" "}
                  (~{Math.max(1, Math.ceil(newLeadCount / 25))} days of paced sending). Use only if you
                  want the current list contacted too.
                </span>
              </label>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => toggle(true)}
                disabled={busy}
                className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                Turn on
              </button>
              <button
                onClick={() => setConfirmOn(false)}
                className="rounded-md border border-amber-300 px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Milestone strip */}
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-xs text-gray-500">Leads acquired</dt>
            <dd className="mt-1 text-lg font-semibold text-gray-900">{status.totals.leads}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Numbers messaged</dt>
            <dd className="mt-1 text-lg font-semibold text-gray-900">
              {messaged}
              {MILESTONES.filter((m) => messaged >= m).map((m) => (
                <span key={m} className="ml-1 rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-700">
                  {m}✓
                </span>
              ))}
              {nextMilestone && (
                <span className="ml-1 text-xs font-normal text-gray-400">next: {nextMilestone}</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Surveys completed</dt>
            <dd className="mt-1 text-lg font-semibold text-gray-900">
              {status.googleFormMode ? <span className="text-sm text-gray-400">n/a in Google-Form mode</span> : status.totals.applied}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Send queue</dt>
            <dd className="mt-1 text-lg font-semibold text-gray-900">
              {status.deferredQueue.depth}
              {status.deferredQueue.oldestAgeDays !== null && (
                <span className="ml-1 text-xs font-normal text-gray-400">
                  oldest {status.deferredQueue.oldestAgeDays}d
                </span>
              )}
            </dd>
          </div>
        </dl>

        {/* Daily history */}
        <div className="mt-4">
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="text-xs font-medium text-blue-600 hover:underline"
          >
            {showHistory ? "Hide" : "Show"} daily history ({status.last30Days.length})
          </button>
          {showHistory && (
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-3 py-2">Day</th>
                    <th className="px-3 py-2">Found</th>
                    <th className="px-3 py-2">New</th>
                    <th className="px-3 py-2">Queued</th>
                    <th className="px-3 py-2">Sent at run</th>
                    <th className="px-3 py-2">Attempts</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {status.last30Days.map((run) => (
                    <tr key={run.day}>
                      <td className="whitespace-nowrap px-3 py-2 text-gray-900">{run.day}</td>
                      <td className="px-3 py-2 text-gray-600">{run.leadsFound}</td>
                      <td className="px-3 py-2 text-gray-600">{run.leadsNew}</td>
                      <td className="px-3 py-2 text-gray-600">{run.queuedSends}</td>
                      <td className="px-3 py-2 text-gray-600">{run.sentImmediate}</td>
                      <td className="px-3 py-2 text-gray-600">{run.attempts}</td>
                      <td className="px-3 py-2">
                        <StatusChip status={run.status} />
                        {run.error && (
                          <span className="ml-1 text-xs text-red-600" title={run.error}>
                            ⚠
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {status.last30Days.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-4 text-center text-xs text-gray-500">
                        No runs yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
