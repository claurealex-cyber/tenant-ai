"use client";

import { useCallback, useEffect, useState } from "react";

interface State { enabled: boolean; message: string; applicantCount: number; pendingCount: number; }

/** Toggle + message for the applicant follow-up segment (people who APPLIED). */
export default function ApplicantRelayPanel() {
  const [st, setSt] = useState<State | null>(null);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/zillow/applicant-relay", { cache: "no-store" });
      if (!r.ok) throw new Error(`status ${r.status}`);
      const d: State = await r.json();
      setSt(d); setMsg(d.message); setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : "load failed"); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (patch: { enabled?: boolean; message?: string }) => {
    if (saving) return;
    setSaving(true); setErr(null);
    try {
      const r = await fetch("/api/admin/zillow/applicant-relay", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `save ${r.status}`);
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : "save failed"); }
    finally { setSaving(false); }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 mb-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Applicant follow-up relay</h3>
        {st && (
          <span className="text-xs text-gray-500">
            {st.applicantCount} applied · <span className="text-gray-900">{st.pendingCount} not yet messaged</span>
          </span>
        )}
      </div>
      <p className="text-xs text-gray-500 mt-0.5">
        Texts people who submitted a Zillow application a follow-up (distinct from the lead link). API mode only.
      </p>

      <label className="mt-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          disabled={saving || !st}
          checked={!!st?.enabled}
          onChange={(e) => save({ enabled: e.target.checked })}
        />
        <span className="text-gray-900">{st?.enabled ? "On — applicants get the follow-up" : "Off"}</span>
      </label>

      <div className="mt-3">
        <label className="text-xs font-medium text-gray-600">Follow-up message</label>
        <textarea
          className="mt-1 w-full rounded-md border border-gray-200 p-2 text-xs"
          rows={3}
          value={msg}
          disabled={saving}
          onChange={(e) => setMsg(e.target.value)}
        />
        <button
          type="button"
          disabled={saving || !msg.trim() || msg === st?.message}
          onClick={() => save({ message: msg })}
          className="mt-1 rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:border-gray-400 disabled:opacity-50"
        >
          Save message
        </button>
      </div>
      {err && <p className="mt-2 text-[11px] text-red-600">{err}</p>}
    </div>
  );
}
