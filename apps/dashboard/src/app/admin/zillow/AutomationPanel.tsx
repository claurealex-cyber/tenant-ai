"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  PRESETS, ALL_HOURS, SLEEPY_HOURS, applyPreset, toggleHour, matchingPreset, summaryFor, bodyFor,
  draftFromStatus, sameSchedule, fmtHour, type ScheduleDraft,
} from "./schedule-ui";

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
  /** Server-computed schedule (shared helper); older servers omit it. */
  schedule?: {
    mode: "fixed" | "hourly";
    hours: number[];
    startHour: number;
    endHour: number;
    runsPerDay: number;
    label: string;
    nextRunLabel: string | null;
    channel: "relay" | "textemall";
    monthlyEstimate: number;
    monthlyCap: number;
    capWarning: boolean;
    timezone: string;
  };
  /** false = the hourly tick is dead (Redis / job not registered): nothing scheduled will fire. */
  schedulerOnline?: boolean;
}

/** Prefer the server's label; fall back to the local one for older servers. */
function labelFor(status: AutoStatus | null): string {
  return status?.schedule?.label ?? cadenceLabel(status?.runHours, status?.startHour, status?.endHour);
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
  // Schedule editor
  const [draft, setDraft] = useState<ScheduleDraft | null>(null);
  const [saved, setSaved] = useState<ScheduleDraft | null>(null);
  // Ref mirror so `load` (stable useCallback) sees the CURRENT saved schedule,
  // not the one captured at mount — otherwise unsaved edits would be wiped on
  // every reload after a toggle / run.
  const savedRef = useRef<ScheduleDraft | null>(null);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [ackCap, setAckCap] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/zillow/auto-status");
      if (res.ok) {
        const st: AutoStatus = await res.json();
        setStatus(st);
        const d = draftFromStatus(st.schedule ?? { runHours: st.runHours, startHour: st.startHour, endHour: st.endHour });
        const prevSaved = savedRef.current;
        savedRef.current = d;
        setSaved(d);
        // Keep the user's unsaved edits; otherwise track the server's schedule.
        setDraft((cur) => (cur && prevSaved && !sameSchedule(cur, prevSaved) ? cur : d));
      }
    } catch {
      /* panel renders its unreachable state */
    }
  }, []);

  const saveSchedule = async (acknowledgeCap: boolean) => {
    if (!draft || !status) return;
    setSavingSchedule(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/zillow/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyFor(draft, { acknowledgeCap, includeBroadcastHour: (status.schedule?.channel ?? "relay") === "textemall" })),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setAckCap(false);
        setNote({ kind: "ok", text: `Schedule: ${data.schedule?.label ?? labelFor(status)} (live at the next :00${data.serverRefreshed === false ? "; server picks it up within a minute" : ""}).` });
        await load();
      } else if (data.needsAck) {
        setAckCap(true);
        setNote({ kind: "err", text: data.error });
      } else {
        setNote({ kind: "err", text: data.error || "Could not save the schedule" });
      }
    } catch {
      setNote({ kind: "err", text: "Could not save the schedule — is the API server running?" });
    } finally {
      setSavingSchedule(false);
    }
  };

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
              `${labelFor(status)}.`
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
          retries at the next scheduled run.
        </div>
      )}
      {status.schedulerOnline === false && (
        <div className="rounded-md border border-red-400 bg-red-50 px-4 py-3 text-sm text-red-900">
          <span className="font-semibold">Scheduled runs are NOT firing.</span> The hourly scheduler is offline
          (Redis down or the job never registered). Nothing on the schedule below will run until Tenant AI is
          restarted with Redis up. &quot;Run now&quot; still works.
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Daily automation</h2>
            <p className="mt-1 text-xs text-gray-500">
              Imports new Zillow leads {labelFor(status)}
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

        {/* Schedule editor — the ONLY place the run times are edited (writes via /api/admin/zillow/schedule) */}
        {draft && saved && (() => {
          const channel = status.schedule?.channel ?? "relay";
          const monthlyCap = status.schedule?.monthlyCap ?? 96;
          const sum = summaryFor(draft, { channel, monthlyCap, nowHour: new Date().getHours(), enabled: status.enabled });
          const dirty = !sameSchedule(draft, saved);
          const preset = matchingPreset(draft);
          return (
            <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-gray-900">Schedule</h3>
                <div className="flex rounded-md border border-gray-300 bg-white text-xs">
                  <button
                    onClick={() => setDraft({ ...draft, mode: "fixed", hours: draft.hours.length ? draft.hours : [10, 16, 22] })}
                    className={`px-3 py-1 rounded-l-md ${draft.mode === "fixed" ? "bg-gray-800 text-white" : "text-gray-700 hover:bg-gray-100"}`}
                  >
                    Fixed times
                  </button>
                  <button
                    onClick={() => setDraft({ ...draft, mode: "hourly" })}
                    className={`px-3 py-1 rounded-r-md ${draft.mode === "hourly" ? "bg-gray-800 text-white" : "text-gray-700 hover:bg-gray-100"}`}
                  >
                    Hourly window
                  </button>
                </div>
              </div>

              {draft.mode === "fixed" ? (
                <>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {PRESETS.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setDraft(applyPreset(draft, p))}
                        className={`rounded-full border px-3 py-1 text-xs ${preset?.id === p.id ? "border-gray-800 bg-gray-800 text-white" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"}`}
                        title={p.hours.map(fmtHour).join(", ")}
                      >
                        {p.label}
                        {p.recommended ? " · free-tier safe" : ""}
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 grid grid-cols-6 gap-1 sm:grid-cols-12">
                    {ALL_HOURS.map((h) => {
                      const on = draft.hours.includes(h);
                      const sleepy = SLEEPY_HOURS.has(h);
                      return (
                        <button
                          key={h}
                          onClick={() => setDraft(toggleHour(draft, h))}
                          title={sleepy ? "This Mac is usually asleep — a run here will be skipped" : `${fmtHour(h)} Chicago time`}
                          className={`rounded px-1 py-1 text-xs tabular-nums ${on ? "bg-green-600 text-white" : sleepy ? "bg-white text-gray-400 border border-dashed border-gray-300" : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-100"}`}
                        >
                          {fmtHour(h)}
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-gray-700">
                  <label>
                    From{" "}
                    <select value={draft.startHour} onChange={(e) => setDraft({ ...draft, startHour: parseInt(e.target.value, 10) })} className="rounded border border-gray-300 px-1 py-0.5">
                      {ALL_HOURS.map((h) => <option key={h} value={h}>{fmtHour(h)}</option>)}
                    </select>
                  </label>
                  <label>
                    to{" "}
                    <select value={draft.endHour} onChange={(e) => setDraft({ ...draft, endHour: parseInt(e.target.value, 10) })} className="rounded border border-gray-300 px-1 py-0.5">
                      {ALL_HOURS.map((h) => <option key={h} value={h}>{fmtHour(h)}</option>)}
                    </select>
                  </label>
                  {channel === "textemall" && (
                    <label>
                      Broadcast at{" "}
                      <select value={draft.broadcastHour} onChange={(e) => setDraft({ ...draft, broadcastHour: parseInt(e.target.value, 10) })} className="rounded border border-gray-300 px-1 py-0.5">
                        {ALL_HOURS.map((h) => <option key={h} value={h}>{fmtHour(h)}</option>)}
                      </select>
                      <span className="ml-1 text-xs text-gray-500">(scrapes every hour; texts new leads once a day)</span>
                    </label>
                  )}
                </div>
              )}

              <div className="mt-3 text-sm text-gray-800">
                <span className="font-medium">{sum.runsPerDay}×/day</span> — {sum.label}
                {sum.nextRunLabel ? ` · next run ${sum.nextRunLabel}` : ""}
                {channel === "textemall" && (
                  <span className={sum.capWarning ? "ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800" : "ml-2 text-xs text-gray-500"}>
                    ≈ {sum.monthlyEstimate} broadcasts/month of cap {monthlyCap}
                    {sum.capWarning ? " — broadcasts would stop mid-month (Zapier free tier)" : ""}
                  </span>
                )}
              </div>
              {sum.sleepyHours.length > 0 && (
                <p className="mt-1 text-xs text-amber-700">
                  {sum.sleepyHours.map(fmtHour).join(", ")}: this Mac is usually asleep then — those runs will be skipped.
                </p>
              )}
              {sum.problems.length > 0 && <p className="mt-1 text-xs text-red-700">{sum.problems.join(" · ")}</p>}
              <p className="mt-2 text-xs text-gray-500">
                :00 only · Chicago time · runs fire only while this Mac is awake · a change takes effect at the next :00 ·
                missed runs are not caught up · on DST nights the 02:00 slot may be skipped
              </p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() => saveSchedule(ackCap)}
                  disabled={!dirty || savingSchedule || sum.problems.length > 0}
                  className="rounded-md bg-gray-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-900 disabled:opacity-40"
                >
                  {savingSchedule ? "Saving…" : ackCap ? "Save anyway (over the free-tier cap)" : "Save schedule"}
                </button>
                <button
                  onClick={() => { setDraft(saved); setAckCap(false); }}
                  disabled={!dirty || savingSchedule}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                >
                  Cancel
                </button>
                {!dirty && <span className="text-xs text-gray-500">saved</span>}
              </div>
            </div>
          );
        })()}

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
