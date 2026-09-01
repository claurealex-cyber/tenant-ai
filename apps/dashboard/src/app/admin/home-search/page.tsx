"use client";

import { useCallback, useEffect, useState } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import ChicagoBrowse from "@/components/ChicagoBrowse";

interface SearchRow {
  id: string;
  label: string;
  enabled: boolean;
  alertsArmed: boolean;
  notifyPhone: string;
  priceMax: number | null;
  priceMin: number | null;
  beds: number | null;
  zips: string[];
  centerLat: number | null;
  centerLng: number | null;
  radiusMi: number | null;
  provider: string;
  lastRunAt: string | null;
  lastRunCount: number;
  _count?: { listings: number };
}
interface ListingRow {
  id: string;
  address: string;
  unit: string | null;
  zip: string | null;
  price: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  status: string;
  daysOnMarket: number | null;
  hoa: number | null;
  qualityFlags: string[];
  sourceUrl: string;
  source: string;
  firstSeenAt: string;
  notified: boolean;
}

const usd = (n: number | null) => (n == null ? "—" : `$${n.toLocaleString("en-US")}`);
const STATUS_STYLE: Record<string, string> = {
  active: "bg-green-50 text-green-700",
  contingent: "bg-amber-50 text-amber-700",
  pending: "bg-amber-50 text-amber-700",
  closed: "bg-gray-100 text-gray-500",
  stale: "bg-gray-100 text-gray-500",
};

export default function HomeSearchPage() {
  const [searches, setSearches] = useState<SearchRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [listings, setListings] = useState<ListingRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ label: "", notifyPhone: "+17084158984", priceMax: "250000", beds: "", zips: "60622,60647" });

  const loadSearches = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/home-search/searches", { cache: "no-store" });
      if (!r.ok) throw new Error(`searches ${r.status}`);
      const d = await r.json();
      setSearches(d.searches);
      if (!selected && d.searches[0]) setSelected(d.searches[0].id);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "load failed");
    }
  }, [selected]);

  const loadListings = useCallback(async (sid: string) => {
    const r = await fetch(`/api/admin/home-search/listings?searchId=${sid}`, { cache: "no-store" });
    if (r.ok) setListings((await r.json()).listings);
  }, []);

  useEffect(() => { loadSearches(); }, [loadSearches]);
  useEffect(() => { if (selected) loadListings(selected); }, [selected, loadListings]);

  const patch = async (id: string, body: Record<string, unknown>) => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/admin/home-search/searches/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `save ${r.status}`);
      await loadSearches();
    } catch (e) { setErr(e instanceof Error ? e.message : "save failed"); }
    finally { setBusy(false); }
  };

  const del = async (id: string) => {
    if (!confirm("Delete this search and its found listings?")) return;
    await fetch(`/api/admin/home-search/searches/${id}`, { method: "DELETE" });
    if (selected === id) setSelected(null);
    await loadSearches();
  };

  const runNow = async (id?: string) => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/admin/home-search/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ searchId: id }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `run ${r.status}`);
      await loadSearches();
      if (selected) await loadListings(selected);
    } catch (e) { setErr(e instanceof Error ? e.message : "run failed"); }
    finally { setBusy(false); }
  };

  const create = async () => {
    setBusy(true); setErr(null);
    try {
      const body = {
        label: form.label || "Untitled search",
        notifyPhone: form.notifyPhone,
        priceMax: form.priceMax ? Number(form.priceMax) : null,
        beds: form.beds ? Number(form.beds) : null,
        zips: form.zips.split(",").map((z) => z.trim()).filter(Boolean),
      };
      const r = await fetch("/api/admin/home-search/searches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `create ${r.status}`);
      setCreating(false);
      setForm({ label: "", notifyPhone: "+17084158984", priceMax: "250000", beds: "", zips: "60622,60647" });
      await loadSearches();
    } catch (e) { setErr(e instanceof Error ? e.message : "create failed"); }
    finally { setBusy(false); }
  };

  return (
    <DashboardShell>
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Home Search</h1>
            <p className="mt-1 text-sm text-gray-500">
              Saved buyer searches that scan public MLS-fed listings and text you new, verified matches.
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => runNow()} disabled={busy} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-gray-400 disabled:opacity-50">
              {busy ? "Running…" : "Run all now"}
            </button>
            <button onClick={() => setCreating((v) => !v)} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
              {creating ? "Cancel" : "New search"}
            </button>
          </div>
        </div>

        {err && <div className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div>}

        <ChicagoBrowse />

        {creating && (
          <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-gray-900">New saved search</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Label"><input className="in" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="≤$250k near Wicker Park" /></Field>
              <Field label="Text alerts to"><input className="in" value={form.notifyPhone} onChange={(e) => setForm({ ...form, notifyPhone: e.target.value })} /></Field>
              <Field label="Max price"><input className="in" value={form.priceMax} onChange={(e) => setForm({ ...form, priceMax: e.target.value })} inputMode="numeric" /></Field>
              <Field label="Min beds"><input className="in" value={form.beds} onChange={(e) => setForm({ ...form, beds: e.target.value })} inputMode="numeric" placeholder="any" /></Field>
              <Field label="ZIP codes (comma-sep)"><input className="in" value={form.zips} onChange={(e) => setForm({ ...form, zips: e.target.value })} /></Field>
            </div>
            <button onClick={create} disabled={busy} className="mt-3 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">Create (starts OFF for alerts)</button>
            <style jsx>{`.in{width:100%;border:1px solid #e5e7eb;border-radius:.375rem;padding:.4rem .55rem;font-size:.85rem}`}</style>
          </div>
        )}

        {/* Saved searches with controls */}
        <div className="mb-6 space-y-2">
          {searches.length === 0 && <p className="text-sm text-gray-500">No searches yet — create one to start.</p>}
          {searches.map((s) => (
            <div key={s.id} className={`rounded-lg border bg-white p-3 ${selected === s.id ? "border-blue-400 ring-1 ring-blue-400" : "border-gray-200"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button onClick={() => setSelected(s.id)} className="text-left">
                  <div className="text-sm font-semibold text-gray-900">{s.label}</div>
                  <div className="text-xs text-gray-500">
                    {usd(s.priceMax)} max · {s.beds ? `${s.beds}+ bd · ` : ""}{s.zips.join(", ") || "any area"} · {s._count?.listings ?? 0} found
                    {s.lastRunAt ? ` · last run ${new Date(s.lastRunAt).toLocaleString()}` : " · never run"}
                  </div>
                </button>
                <div className="flex items-center gap-3">
                  <Toggle label="Search on" on={s.enabled} onClick={() => patch(s.id, { enabled: !s.enabled })} />
                  <Toggle label="Text alerts" on={s.alertsArmed} onClick={() => patch(s.id, { alertsArmed: !s.alertsArmed })} danger />
                  <button onClick={() => runNow(s.id)} disabled={busy} className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:border-gray-400 disabled:opacity-50">Run now</button>
                  <button onClick={() => del(s.id)} className="rounded border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:border-red-300">Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Dataset for the selected search */}
        {selected && (
          <div className="rounded-lg border border-gray-200 bg-white">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2">
              <h3 className="text-sm font-semibold text-gray-900">Found listings</h3>
              <span className="text-xs text-gray-500">{listings.length} shown</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-2">Price</th><th className="px-4 py-2">Address</th><th className="px-4 py-2">Bd/Ba</th>
                    <th className="px-4 py-2">Status</th><th className="px-4 py-2">DOM</th><th className="px-4 py-2">Found</th><th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {listings.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-gray-400">No listings yet — run the search.</td></tr>}
                  {listings.map((l) => (
                    <tr key={l.id} className="border-t border-gray-50">
                      <td className="px-4 py-2 font-medium text-gray-900 tabular-nums">{usd(l.price)}</td>
                      <td className="px-4 py-2 text-gray-700">{l.address}{l.unit ? ` #${l.unit}` : ""}{l.zip ? `, ${l.zip}` : ""}
                        {l.qualityFlags?.includes("garden_unit") && <span className="ml-1 rounded bg-gray-100 px-1 text-[10px] text-gray-500">garden</span>}
                      </td>
                      <td className="px-4 py-2 text-gray-600">{l.beds ?? "?"}/{l.baths ?? "?"}</td>
                      <td className="px-4 py-2"><span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_STYLE[l.status] || "bg-gray-100 text-gray-500"}`}>{l.status}</span></td>
                      <td className="px-4 py-2 text-gray-500 tabular-nums">{l.daysOnMarket ?? "—"}</td>
                      <td className="px-4 py-2 text-gray-500">{new Date(l.firstSeenAt).toLocaleDateString()}</td>
                      <td className="px-4 py-2"><a href={l.sourceUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">open</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>
      {children}
    </label>
  );
}

function Toggle({ label, on, onClick, danger }: { label: string; on: boolean; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1.5 text-xs" type="button">
      <span className={`inline-flex h-4 w-7 items-center rounded-full transition ${on ? (danger ? "bg-amber-500" : "bg-green-500") : "bg-gray-300"}`}>
        <span className={`h-3 w-3 rounded-full bg-white transition ${on ? "translate-x-3.5" : "translate-x-0.5"}`} />
      </span>
      <span className="text-gray-600">{label}</span>
    </button>
  );
}
