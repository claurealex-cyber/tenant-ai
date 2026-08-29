"use client";

import { useCallback, useEffect, useState } from "react";

type Method = "imessage" | "zapier" | "api";
interface LaneStatus {
  lane: "zillow" | "individual";
  transport: "textemall" | "relay";
  method: "api" | "form";
  effective: string;
  caveats: string[];
}
interface RoutingStatus {
  zillow: LaneStatus;
  individual: LaneStatus;
  perCallerNote: string;
}

const OPTIONS: { value: Method; label: string; hint: string }[] = [
  { value: "imessage", label: "Apple iMessage relay", hint: "Send from your Mac's Messages app (Telnyx if relay off)." },
  { value: "zapier", label: "Text-Em-All · Google Form", hint: "Group edit → Google Form → Zapier (100 tasks/mo free tier)." },
  { value: "api", label: "Text-Em-All · Direct API", hint: "Send straight through the Text-Em-All API — no Zapier, no cap." },
];

/** Map a lane's resolved transport+method to the 3-way control value. */
function laneToMethod(s: LaneStatus): Method {
  if (s.transport === "relay") return "imessage";
  return s.method === "api" ? "api" : "zapier";
}

export default function DeliveryMethodPanel({ lane }: { lane: "zillow" | "individual" }) {
  const [status, setStatus] = useState<RoutingStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/delivery-method", { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `status ${res.status}`);
      setStatus(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not load delivery status");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const laneStatus = status?.[lane] ?? null;
  const current = laneStatus ? laneToMethod(laneStatus) : null;

  const choose = async (method: Method) => {
    // Allow re-clicking the current method: writes are idempotent, so this lets
    // the user REPAIR a half-set state (e.g. channel on but not armed) instead of
    // being stuck because the fix looks already-selected.
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/delivery-method", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lane, method }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `save failed (${res.status})`);
      if (body?.status) setStatus(body.status);
      else await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  };

  const title = lane === "zillow" ? "Zillow broadcast delivery" : "Caller & text delivery";
  const scope =
    lane === "zillow"
      ? "How new Zillow leads are messaged by the automatic workflow."
      : "How links go to people who TEXT or CALL your number (both use this).";

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 mb-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {laneStatus && (
          <span className="text-xs font-medium text-gray-500">
            Now: <span className="text-gray-900">{laneStatus.effective}</span>
          </span>
        )}
      </div>
      <p className="text-xs text-gray-500 mt-0.5">{scope}</p>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {OPTIONS.map((o) => {
          const active = current === o.value;
          return (
            <button
              key={o.value}
              type="button"
              disabled={saving}
              onClick={() => choose(o.value)}
              className={`text-left rounded-md border p-2.5 transition ${
                active ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500" : "border-gray-200 hover:border-gray-300"
              } ${saving ? "opacity-60 cursor-wait" : ""}`}
            >
              <div className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${active ? "bg-blue-500" : "bg-gray-300"}`} />
                <span className="text-xs font-semibold text-gray-900">{o.label}</span>
              </div>
              <p className="text-[11px] leading-snug text-gray-500 mt-1">{o.hint}</p>
            </button>
          );
        })}
      </div>

      {laneStatus && laneStatus.caveats.length > 0 && (
        <ul className="mt-3 space-y-1">
          {laneStatus.caveats.map((c, i) => (
            <li key={i} className="text-[11px] text-amber-700 flex gap-1.5">
              <span aria-hidden>⚠</span>
              <span>{c}</span>
            </li>
          ))}
        </ul>
      )}
      {lane === "individual" && status?.perCallerNote && (
        <p className="mt-2 text-[11px] text-gray-400">{status.perCallerNote}</p>
      )}
      {error && <p className="mt-2 text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
