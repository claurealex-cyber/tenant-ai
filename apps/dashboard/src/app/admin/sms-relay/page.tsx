"use client";

import { useCallback, useEffect, useState } from "react";
import DashboardShell from "@/components/layout/DashboardShell";

interface RelayField {
  key: string;
  label: string;
  sensitive: boolean;
  required: boolean;
  placeholder: string | null;
  helpText: string | null;
  hasValue: boolean;
  source: "database" | "environment" | "none";
}

interface RelayProperty {
  id: string;
  name: string;
  twilioPhone: string | null;
  isActive: boolean;
  smsIntakeEnabled: boolean;
  intakeAutoReply: string | null;
}

interface RelayStatus {
  intakeProperties: number;
  outstandingInvites: number;
  optOutCount: number;
  ledger: { pending: number; failed: number; sent: number } | null;
  survey?: {
    requestedMode: "hosted" | "google_form";
    mode: "hosted" | "google_form";
    formUrl: string | null;
    warning: string | null;
  };
  intake?: { style: "link_only" | "link_and_qa"; greeting: string };
  relayEnabled?: boolean;
  qaToday?: number | null;
  callers?: { callerLink: "off" | "when_asked" | "every_call"; voiceIntake: "phone" | "link" };
}

export default function SmsRelayPage() {
  const [fields, setFields] = useState<RelayField[]>([]);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [properties, setProperties] = useState<RelayProperty[]>([]);
  const [status, setStatus] = useState<RelayStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [optOutPhone, setOptOutPhone] = useState("");
  const [autoReplyDrafts, setAutoReplyDrafts] = useState<Record<string, string>>({});
  const [individual, setIndividual] = useState<{ channel: "relay" | "textemall"; armed: boolean; testNumbers: string; group: string } | null>(null);
  const [broadcastMethod, setBroadcastMethod] = useState<"api" | "form" | null>(null);
  const [testNumbersDraft, setTestNumbersDraft] = useState("");

  const load = useCallback(async () => {
    try {
      const [intRes, propRes, statRes, indRes] = await Promise.all([
        fetch("/api/admin/integrations"),
        fetch("/api/admin/sms-relay/property"),
        fetch("/api/admin/sms-relay/status"),
        fetch("/api/admin/sms-relay/individual-channel"),
      ]);
      if (indRes.ok) {
        const ind = await indRes.json();
        setIndividual(ind);
        try { const bm = await (await fetch("/api/admin/sms-relay/broadcast-method")).json(); setBroadcastMethod(bm.method); } catch {}
        setTestNumbersDraft(ind.testNumbers || "");
      }
      if (intRes.ok) {
        const data = await intRes.json();
        const relay = (data.integrations || []).find((i: any) => i.id === "sms_relay");
        setFields(relay?.fields || []);
      }
      if (propRes.ok) {
        const data = await propRes.json();
        setProperties(data.properties || []);
        setAutoReplyDrafts(
          Object.fromEntries(
            (data.properties || []).map((p: RelayProperty) => [p.id, p.intakeAutoReply || ""])
          )
        );
      }
      if (statRes.ok) setStatus(await statRes.json());
    } catch {
      setBanner({ kind: "err", text: "Failed to load SMS relay settings" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveSettings = async () => {
    const values: Record<string, string> = {};
    for (const [k, v] of Object.entries(fieldValues)) {
      if (v !== "") values[k] = v;
    }
    if (Object.keys(values).length === 0) {
      setBanner({ kind: "err", text: "No changes to save" });
      return;
    }
    setSaving(true);
    setBanner(null);
    try {
      const res = await fetch("/api/admin/integrations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ integrationId: "sms_relay", values }),
      });
      if (res.ok) {
        await fetch("/api/admin/sms-relay/refresh-config", { method: "POST" }).catch(() => {});
        setBanner({ kind: "ok", text: "Settings saved and live now." });
        setFieldValues({});
        await load();
      } else {
        const data = await res.json().catch(() => ({}));
        setBanner({ kind: "err", text: data.error || "Save failed" });
      }
    } catch {
      setBanner({ kind: "err", text: "Save failed" });
    } finally {
      setSaving(false);
    }
  };

  const setRelayField = async (key: string, value: string, okText: string) => {
    setBanner(null);
    try {
      const res = await fetch("/api/admin/integrations", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ integrationId: "sms_relay", values: { [key]: value } }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setBanner({ kind: "err", text: d.error || "Could not save" }); return; }
      await fetch("/api/admin/sms-relay/refresh-config", { method: "POST" }).catch(() => {});
      setBanner({ kind: "ok", text: okText });
      await load();
    } catch { setBanner({ kind: "err", text: "Could not save" }); }
  };

  const setIntakeStyle = async (style: "link_only" | "link_and_qa") => {
    if (status?.intake?.style === style) return;
    setBanner(null);
    try {
      const res = await fetch("/api/admin/integrations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ integrationId: "sms_relay", values: { intake_style: style } }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setBanner({ kind: "err", text: data.error || "Could not change reply style" });
        return;
      }
      // Make it live in the server process immediately (no 60s wait).
      await fetch("/api/admin/sms-relay/refresh-config", { method: "POST" }).catch(() => {});
      setBanner({
        kind: "ok",
        text: style === "link_and_qa" ? "Reply style: Link + Q&A (live now)" : "Reply style: Link only (live now)",
      });
      await load();
    } catch {
      setBanner({ kind: "err", text: "Could not change reply style" });
    }
  };

  const updateBroadcastMethod = async (method: "api" | "form") => {
    setBanner(null);
    try {
      const res = await fetch("/api/admin/sms-relay/broadcast-method", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ method }),
      });
      if (!res.ok) { setBanner({ kind: "err", text: "Could not change broadcast method" }); return; }
      await fetch("/api/admin/sms-relay/refresh-config", { method: "POST" }).catch(() => {});
      setBroadcastMethod(method);
      setBanner({ kind: "ok", text: method === "api" ? "Broadcasts now via direct Text-Em-All API (no Zapier)" : "Broadcasts now via Google Form → Zapier" });
    } catch { setBanner({ kind: "err", text: "Could not change broadcast method" }); }
  };

  const updateIndividual = async (patch: { channel?: "relay" | "textemall"; armed?: boolean; testNumbers?: string }) => {
    setBanner(null);
    try {
      const res = await fetch("/api/admin/sms-relay/individual-channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setBanner({ kind: "err", text: data.error || "Could not update individual relay" });
        return;
      }
      await fetch("/api/admin/sms-relay/refresh-config", { method: "POST" }).catch(() => {});
      setBanner({ kind: "ok", text: "Individual link delivery updated" });
      await load();
    } catch {
      setBanner({ kind: "err", text: "Could not update individual relay" });
    }
  };

  const patchProperty = async (
    propertyId: string,
    patch: { smsIntakeEnabled?: boolean; intakeAutoReply?: string }
  ) => {
    setBanner(null);
    const res = await fetch("/api/admin/sms-relay/property", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyId, ...patch }),
    });
    if (res.ok) {
      setBanner({ kind: "ok", text: "Property updated" });
      await load();
    } else {
      const data = await res.json().catch(() => ({}));
      setBanner({ kind: "err", text: data.error || "Update failed" });
    }
  };

  const submitOptOut = async () => {
    const property = properties.find((p) => p.smsIntakeEnabled) || properties[0];
    if (!property) {
      setBanner({ kind: "err", text: "No phone-bearing property found" });
      return;
    }
    const res = await fetch("/api/admin/sms-relay/optout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: optOutPhone.trim(), propertyId: property.id }),
    });
    if (res.ok) {
      setBanner({ kind: "ok", text: `${optOutPhone.trim()} opted out` });
      setOptOutPhone("");
      await load();
    } else {
      const data = await res.json().catch(() => ({}));
      setBanner({ kind: "err", text: data.error || "Opt-out failed" });
    }
  };

  return (
    <DashboardShell>
      <div className="mx-auto max-w-4xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">SMS Relay</h1>
          <p className="mt-1 text-sm text-gray-500">
            Temporary workflow while 10DLC registration is pending: inbound texts arrive via
            Telnyx; outbound (survey links and forwards) go out through the Mac&apos;s Messages
            app from the personal number.
          </p>
        </div>

        {banner && (
          <div
            className={`mb-4 rounded-md px-4 py-3 text-sm ${
              banner.kind === "ok"
                ? "bg-green-50 text-green-800"
                : "bg-red-50 text-red-800"
            }`}
          >
            {banner.text}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Status panel */}
            <div className="rounded-lg border border-gray-200 bg-white p-6">
              <h2 className="text-sm font-semibold text-gray-900">Status</h2>
              <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-gray-500">Intake-enabled properties</dt>
                  <dd className="mt-1 text-lg font-semibold text-gray-900">
                    {status?.intakeProperties ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500">Outstanding survey invites</dt>
                  <dd className="mt-1 text-lg font-semibold text-gray-900">
                    {status?.outstandingInvites ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500">Opt-outs recorded</dt>
                  <dd className="mt-1 text-lg font-semibold text-gray-900">
                    {status?.optOutCount ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500">Relay sends</dt>
                  <dd className="mt-1 text-lg font-semibold text-gray-900">
                    {status?.ledger
                      ? `${status.ledger.sent} sent / ${status.ledger.failed} failed`
                      : "engine not deployed"}
                  </dd>
                </div>
              </dl>
              {/* Survey link mode — what intake texts / Zillow blasts actually send */}
              {status?.survey && (
                <div className="mt-4 border-t border-gray-100 pt-4" data-testid="survey-mode">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-gray-500">Survey link:</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        status.survey.mode === "google_form"
                          ? "bg-green-100 text-green-800"
                          : "bg-blue-100 text-blue-800"
                      }`}
                    >
                      {status.survey.mode === "google_form" ? "Google Form" : "Hosted survey"}
                    </span>
                    {status.survey.mode === "google_form" && status.survey.formUrl && (
                      <a
                        href={status.survey.formUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate text-xs text-blue-600 hover:underline"
                        style={{ maxWidth: "32rem" }}
                      >
                        {status.survey.formUrl}
                      </a>
                    )}
                  </div>
                  {status.survey.warning && (
                    <p className="mt-2 text-xs text-amber-700">⚠ {status.survey.warning}</p>
                  )}
                </div>
              )}
              {/* Intake reply style — one-click switch */}
              {status?.intake && (
                <div className="mt-4 border-t border-gray-100 pt-4" data-testid="intake-style">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs text-gray-500">Reply style:</span>
                    <div className="inline-flex overflow-hidden rounded-md border border-gray-300">
                      <button
                        type="button"
                        onClick={() => setIntakeStyle("link_only")}
                        className={`px-3 py-1 text-xs font-medium ${
                          status.intake.style === "link_only"
                            ? "bg-blue-600 text-white"
                            : "bg-white text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        Link only
                      </button>
                      <button
                        type="button"
                        onClick={() => setIntakeStyle("link_and_qa")}
                        className={`border-l border-gray-300 px-3 py-1 text-xs font-medium ${
                          status.intake.style === "link_and_qa"
                            ? "bg-blue-600 text-white"
                            : "bg-white text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        Link + Q&amp;A
                      </button>
                    </div>
                    <span className="text-xs text-gray-400">
                      {status.intake.style === "link_and_qa"
                        ? "Greeting + link, then the AI answers property questions"
                        : "Texts the application link only"}
                    </span>
                  </div>
                  {status.intake.style === "link_and_qa" && status.relayEnabled && (
                    <p className="mt-2 text-xs text-amber-700">
                      Relay is on: Q&amp;A answers go out from the personal number under their own caps.
                    </p>
                  )}
                  {status.intake.style === "link_and_qa" && typeof status.qaToday === "number" && (
                    <p className="mt-1 text-xs text-gray-500">Q&amp;A replies today: {status.qaToday}</p>
                  )}
                </div>
              )}
              {/* Text-Em-All broadcast method — Google Form/Zapier vs direct REST API */}
              {broadcastMethod && (
                <div className="mt-4 border-t border-gray-100 pt-4" data-testid="broadcast-method">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs text-gray-500">Text-Em-All broadcast method:</span>
                    <div className="inline-flex overflow-hidden rounded-md border border-gray-300">
                      <button
                        type="button"
                        onClick={() => updateBroadcastMethod("form")}
                        className={`px-3 py-1 text-xs font-medium ${broadcastMethod === "form" ? "bg-blue-600 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}
                      >
                        Google Form → Zapier
                      </button>
                      <button
                        type="button"
                        onClick={() => updateBroadcastMethod("api")}
                        className={`border-l border-gray-300 px-3 py-1 text-xs font-medium ${broadcastMethod === "api" ? "bg-blue-600 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}
                      >
                        Direct API
                      </button>
                    </div>
                    <span className="text-xs text-gray-400">
                      {broadcastMethod === "api"
                        ? "Sends directly (no Zapier, no 100/mo cap, targets numbers) — applies to Zillow + caller/text"
                        : "Uses the Google Form → Zapier path"}
                    </span>
                  </div>
                </div>
              )}
              {/* Individual link delivery — relay (default) vs Text-Em-All (opt-in, disarmed) */}
              {individual && (
                <div className="mt-4 border-t border-gray-100 pt-4" data-testid="individual-channel">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs text-gray-500">Caller/text link delivery:</span>
                    <div className="inline-flex overflow-hidden rounded-md border border-gray-300">
                      <button
                        type="button"
                        onClick={() => updateIndividual({ channel: "relay" })}
                        className={`px-3 py-1 text-xs font-medium ${individual.channel === "relay" ? "bg-blue-600 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}
                      >
                        Relay
                      </button>
                      <button
                        type="button"
                        onClick={() => updateIndividual({ channel: "textemall" })}
                        className={`border-l border-gray-300 px-3 py-1 text-xs font-medium ${individual.channel === "textemall" ? "bg-blue-600 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}
                      >
                        Text-Em-All
                      </button>
                    </div>
                    <span className="text-xs text-gray-400">Group: {individual.group}</span>
                  </div>
                  {individual.channel === "textemall" && (
                    <div className="mt-3 space-y-2">
                      <label className="flex items-center gap-2 text-xs text-gray-700">
                        <input
                          type="checkbox"
                          checked={individual.armed}
                          onChange={(e) => updateIndividual({ armed: e.target.checked })}
                        />
                        <span className="font-medium">Armed</span> — fire real broadcasts
                        {!individual.armed && <span className="text-gray-400"> (off → every caller falls back to relay)</span>}
                      </label>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-gray-500">Test numbers (comma-separated; only these fire live, others → relay):</span>
                        <input
                          type="text"
                          value={testNumbersDraft}
                          onChange={(e) => setTestNumbersDraft(e.target.value)}
                          placeholder="+17084158984, +13129752365"
                          className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => updateIndividual({ testNumbers: testNumbersDraft })}
                          className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                        >
                          Save
                        </button>
                      </div>
                      {individual.armed && !testNumbersDraft.trim() && (
                        <p className="text-xs text-amber-700">⚠️ Armed with no test list — this goes live for ALL callers/texters.</p>
                      )}
                      <p className="text-xs text-gray-400">The relay is the guaranteed fallback — a caller always gets exactly one link.</p>
                    </div>
                  )}
                </div>
              )}
              {/* Callers — text the application link to phone callers */}
              {status?.callers && (
                <div className="mt-4 border-t border-gray-100 pt-4" data-testid="caller-controls">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs text-gray-500">Text callers the link:</span>
                    <div className="inline-flex overflow-hidden rounded-md border border-gray-300">
                      {(["off", "when_asked", "every_call"] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setRelayField("caller_link", m, `Callers: ${m.replace("_", " ")} (live)`)}
                          className={`px-3 py-1 text-xs font-medium ${m !== "off" ? "border-l border-gray-300" : ""} ${
                            status.callers!.callerLink === m ? "bg-blue-600 text-white" : "bg-white text-gray-700 hover:bg-gray-50"
                          }`}
                        >
                          {m === "off" ? "Off" : m === "when_asked" ? "When asked" : "Every call"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <span className="text-xs text-gray-500">Phone application:</span>
                    <div className="inline-flex overflow-hidden rounded-md border border-gray-300">
                      {(["phone", "link"] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          disabled={m === "link" && status.callers!.callerLink === "off"}
                          title={m === "link" && status.callers!.callerLink === "off" ? "Turn on 'Text callers the link' first" : ""}
                          onClick={() => setRelayField("voice_intake", m, `Phone application: ${m === "link" ? "link only" : "by phone"} (live)`)}
                          className={`px-3 py-1 text-xs font-medium ${m === "link" ? "border-l border-gray-300" : ""} disabled:opacity-40 ${
                            status.callers!.voiceIntake === m ? "bg-blue-600 text-white" : "bg-white text-gray-700 hover:bg-gray-50"
                          }`}
                        >
                          {m === "phone" ? "Take it by phone" : "Link only"}
                        </button>
                      ))}
                    </div>
                    <span className="text-xs text-gray-400">
                      {status.callers!.voiceIntake === "link" ? "AI answers + texts the link (no phone application)" : "AI takes the application by voice"}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Property intake toggles */}
            <div className="rounded-lg border border-gray-200 bg-white p-6">
              <h2 className="text-sm font-semibold text-gray-900">SMS Intake per Property</h2>
              <p className="mt-1 text-xs text-gray-500">
                ON = inbound texts get the survey link. OFF = normal AI apply conversation.
                This is also the retirement switch once 10DLC approves.
              </p>
              <div className="mt-4 space-y-4">
                {properties.map((p) => (
                  <div key={p.id} className="rounded-md border border-gray-100 p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-sm font-medium text-gray-900">{p.name}</span>
                        <span className="ml-2 text-xs text-gray-500">{p.twilioPhone}</span>
                        {!p.isActive && (
                          <span className="ml-2 rounded bg-yellow-100 px-1.5 py-0.5 text-xs text-yellow-800">
                            inactive
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() =>
                          patchProperty(p.id, { smsIntakeEnabled: !p.smsIntakeEnabled })
                        }
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          p.smsIntakeEnabled ? "bg-blue-600" : "bg-gray-200"
                        }`}
                        aria-label={`Toggle SMS intake for ${p.name}`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            p.smsIntakeEnabled ? "translate-x-6" : "translate-x-1"
                          }`}
                        />
                      </button>
                    </div>
                    <div className="mt-3">
                      <label className="block text-xs font-medium text-gray-700">
                        Intake auto-reply (sent with the survey link)
                      </label>
                      <textarea
                        value={autoReplyDrafts[p.id] ?? ""}
                        onChange={(e) =>
                          setAutoReplyDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))
                        }
                        rows={2}
                        placeholder="Thanks for your interest! Fill out our quick application: "
                        className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      {(autoReplyDrafts[p.id] ?? "") !== (p.intakeAutoReply || "") && (
                        <button
                          onClick={() =>
                            patchProperty(p.id, { intakeAutoReply: autoReplyDrafts[p.id] ?? "" })
                          }
                          className="mt-2 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                        >
                          Save auto-reply
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {properties.length === 0 && (
                  <p className="text-sm text-gray-500">No phone-bearing properties found.</p>
                )}
              </div>
            </div>

            {/* Relay settings */}
            <div className="rounded-lg border border-gray-200 bg-white p-6">
              <h2 className="text-sm font-semibold text-gray-900">Relay Settings</h2>
              <div className="mt-4 space-y-4">
                {fields.map((field) => (
                  <div key={field.key}>
                    <div className="flex items-center justify-between">
                      <label className="block text-sm font-medium text-gray-700">
                        {field.label}
                        {field.required && <span className="ml-1 text-red-500">*</span>}
                      </label>
                      {field.hasValue && (
                        <span
                          className={`text-xs ${
                            field.source === "database" ? "text-blue-500" : "text-gray-400"
                          }`}
                        >
                          from {field.source}
                        </span>
                      )}
                    </div>
                    <input
                      type={field.sensitive ? "password" : "text"}
                      value={fieldValues[field.key] ?? ""}
                      onChange={(e) =>
                        setFieldValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                      }
                      placeholder={
                        field.hasValue ? "********** (unchanged)" : field.placeholder || ""
                      }
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    {field.helpText && (
                      <p className="mt-1 text-xs text-gray-500">{field.helpText}</p>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-6">
                <button
                  onClick={saveSettings}
                  disabled={saving}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save Settings"}
                </button>
              </div>
            </div>

            {/* Manual opt-out */}
            <div className="rounded-lg border border-gray-200 bg-white p-6">
              <h2 className="text-sm font-semibold text-gray-900">Manual Opt-Out</h2>
              <p className="mt-1 text-xs text-gray-500">
                If someone replies STOP to your personal Messages thread, record it here so the
                relay never texts them again.
              </p>
              <div className="mt-3 flex gap-2">
                <input
                  type="text"
                  value={optOutPhone}
                  onChange={(e) => setOptOutPhone(e.target.value)}
                  placeholder="+17085551234"
                  className="block w-64 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                  onClick={submitOptOut}
                  disabled={!optOutPhone.trim()}
                  className="rounded-md bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-900 disabled:opacity-50"
                >
                  Opt Out
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
