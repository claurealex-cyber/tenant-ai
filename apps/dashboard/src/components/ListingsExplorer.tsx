"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Row {
  id: string; address: string; unit: string | null; zip: string | null; neighborhood: string | null;
  price: number | null; beds: number | null; baths: number | null; sqft: number | null;
  propertyType: string; status: string; daysOnMarket: number | null; sourceUrl: string | null; firstSeenAt: string;
}
interface Cluster { name: string; areas: string[]; }

const usd = (n: number | null) => (n == null ? "—" : `$${n.toLocaleString("en-US")}`);
const TYPES: { key: string; label: string }[] = [
  { key: "single_family", label: "Single-family" }, { key: "condo", label: "Condo" },
  { key: "townhome", label: "Townhome" }, { key: "multi", label: "Multi-family" },
];
const TYPE_STYLE: Record<string, string> = { single_family: "bg-emerald-50 text-emerald-700", condo: "bg-blue-50 text-blue-700", townhome: "bg-violet-50 text-violet-700", multi: "bg-amber-50 text-amber-700" };

export default function ListingsExplorer({ provider = "rentcast" }: { provider?: "rentcast" | "public" }) {
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [areaSel, setAreaSel] = useState<Set<string>>(new Set());
  const [typeSel, setTypeSel] = useState<Set<string>>(new Set());
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [beds, setBeds] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("price_asc");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; listings: Row[] }>({ total: 0, listings: [] });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const pageSize = 50;
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch("/api/admin/listings-explorer/areas").then((r) => (r.ok ? r.json() : { clusters: [] })).then((d) => setClusters(d.clusters || [])).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    const p = new URLSearchParams();
    if (priceMin) p.set("priceMin", priceMin);
    if (priceMax) p.set("priceMax", priceMax);
    if (beds) p.set("beds", beds);
    if (q) p.set("q", q);
    if (areaSel.size) p.set("neighborhoods", [...areaSel].join(","));
    if (typeSel.size) p.set("propertyTypes", [...typeSel].join(","));
    p.set("sort", sort); p.set("page", String(page)); p.set("pageSize", String(pageSize));
    abortRef.current?.abort();
    const ctrl = new AbortController(); abortRef.current = ctrl;
    try {
      const r = await fetch(`/api/admin/listings-explorer/dataset?${p.toString()}`, { cache: "no-store", signal: ctrl.signal });
      if (r.ok) setData(await r.json());
    } catch (e) { if ((e as any)?.name !== "AbortError") setMsg(e instanceof Error ? e.message : "load failed"); }
  }, [priceMin, priceMax, beds, q, areaSel, typeSel, sort, page]);

  useEffect(() => { const t = setTimeout(() => { load(); }, 300); return () => clearTimeout(t); }, [load]);

  const toggle = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, v: string) => {
    setPage(1); setter((prev) => { const n = new Set(prev); n.has(v) ? n.delete(v) : n.add(v); return n; });
  };

  const compile = async (body: Record<string, unknown>, label: string) => {
    setBusy(true); setMsg(`Compiling ${label}…`);
    try {
      const r = await fetch("/api/admin/listings-explorer/compile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || `compile ${r.status}`);
      const c = d.compile || {};
      if (c.skipped) { setMsg("A compile is already running — try again in a moment."); return; }
      setMsg(`Compiled ${(c.areasCompiled || []).length} area(s): ${c.newRows ?? 0} new, ${c.fetched ?? 0} fetched.`);
      await load();
    } catch (e) { setMsg(e instanceof Error ? e.message : "compile failed"); }
    finally { setBusy(false); }
  };

  const pages = Math.max(1, Math.ceil(data.total / pageSize));

  return (
    <div className="mb-8">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Listings Explorer</h2>
          <p className="text-xs text-gray-500">{provider === "public" ? "All types from public Movoto index pages (free, links out). Filter by type, price, neighborhood." : "All property types via RentCast (licensed). Filter by type, price, and neighborhood."}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {areaSel.size > 0 && (
            <button onClick={() => { const b = [...areaSel].slice(0, 8); compile({ areas: b, provider, types: typeSel.size ? [...typeSel] : undefined }, `${b.length} area(s)`); }} disabled={busy}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">Compile selected ({areaSel.size})</button>
          )}
          <button onClick={() => compile({ rolling: true, maxAreas: 6, provider, types: typeSel.size ? [...typeSel] : undefined }, "more of Chicago")} disabled={busy}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-gray-400 disabled:opacity-50">Compile more of Chicago</button>
        </div>
      </div>
      {msg && <div className="mb-2 text-xs text-gray-600">{msg}</div>}

      {/* Property type */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {TYPES.map((t) => (
          <button key={t.key} type="button" onClick={() => toggle(setTypeSel, t.key)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${typeSel.has(t.key) ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-600 hover:border-gray-300"}`}>{t.label}</button>
        ))}
        <span className="self-center text-[11px] text-gray-400">{typeSel.size ? "" : "all types"}</span>
      </div>

      {/* Filters */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <L label="Min price"><input className="in" value={priceMin} onChange={(e) => { setPage(1); setPriceMin(e.target.value); }} inputMode="numeric" placeholder="any" /></L>
        <L label="Max price"><input className="in" value={priceMax} onChange={(e) => { setPage(1); setPriceMax(e.target.value); }} inputMode="numeric" placeholder="any" /></L>
        <L label="Min beds"><input className="in" value={beds} onChange={(e) => { setPage(1); setBeds(e.target.value); }} inputMode="numeric" placeholder="any" /></L>
        <L label="Sort"><select className="in" value={sort} onChange={(e) => { setPage(1); setSort(e.target.value); }}><option value="price_asc">Price ↑</option><option value="price_desc">Price ↓</option><option value="newest">Newest</option></select></L>
        <L label="Address contains"><input className="in" value={q} onChange={(e) => { setPage(1); setQ(e.target.value); }} placeholder="e.g. Rogers" /></L>
      </div>

      {/* Neighborhoods */}
      <div className="mt-3">
        {clusters.map((c) => (
          <div key={c.name} className="mb-2">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{c.name}</div>
            <div className="flex flex-wrap gap-1.5">
              {c.areas.map((a) => (
                <button key={a} type="button" onClick={() => toggle(setAreaSel, a)}
                  className={`rounded-full border px-2.5 py-0.5 text-xs ${areaSel.has(a) ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-600 hover:border-gray-300"}`}>{a}</button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
        <span>{data.total} listing(s)</span><span>page {page} / {pages}</span>
      </div>
      <div className="mt-1 overflow-x-auto rounded-md border border-gray-100">
        <table className="w-full text-sm">
          <thead><tr className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <th className="px-3 py-2">Price</th><th className="px-3 py-2">Address</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Area</th><th className="px-3 py-2">Bd/Ba</th><th className="px-3 py-2">Sqft</th><th className="px-3 py-2">DOM</th><th className="px-3 py-2"></th>
          </tr></thead>
          <tbody>
            {data.listings.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-sm text-gray-400">{areaSel.size > 0 ? "No listings for the selected area(s) yet — click Compile selected." : "No listings — select an area and compile, or adjust filters."}</td></tr>}
            {data.listings.map((l) => (
              <tr key={l.id} className="border-t border-gray-50">
                <td className="px-3 py-2 font-medium tabular-nums text-gray-900">{usd(l.price)}</td>
                <td className="px-3 py-2 text-gray-700">{l.address}{l.unit ? ` #${l.unit}` : ""}{l.zip ? `, ${l.zip}` : ""}</td>
                <td className="px-3 py-2"><span className={`rounded px-1.5 py-0.5 text-xs ${TYPE_STYLE[l.propertyType] || "bg-gray-100 text-gray-500"}`}>{l.propertyType.replace("_", " ")}</span></td>
                <td className="px-3 py-2 text-gray-500">{l.neighborhood ?? "—"}</td>
                <td className="px-3 py-2 text-gray-600">{l.beds ?? "?"}/{l.baths ?? "?"}</td>
                <td className="px-3 py-2 text-gray-500 tabular-nums">{l.sqft ?? "—"}</td>
                <td className="px-3 py-2 text-gray-500 tabular-nums">{l.daysOnMarket ?? "—"}</td>
                <td className="px-3 py-2">{l.sourceUrl ? <a href={l.sourceUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">open</a> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="mt-3 flex justify-center gap-2">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded border border-gray-300 px-3 py-1 text-xs disabled:opacity-40">Prev</button>
          <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded border border-gray-300 px-3 py-1 text-xs disabled:opacity-40">Next</button>
        </div>
      )}
      <style jsx>{`.in{width:100%;border:1px solid #e5e7eb;border-radius:.375rem;padding:.4rem .55rem;font-size:.85rem}`}</style>
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>{children}</label>;
}
