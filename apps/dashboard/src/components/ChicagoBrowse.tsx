"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Row {
  id: string; address: string; unit: string | null; zip: string | null; neighborhood: string | null;
  price: number | null; beds: number | null; baths: number | null; sqft: number | null;
  status: string; daysOnMarket: number | null; sourceUrl: string; source: string; firstSeenAt: string;
}
interface Cluster { name: string; areas: string[]; }

const usd = (n: number | null) => (n == null ? "—" : `$${n.toLocaleString("en-US")}`);
const STATUS: Record<string, string> = { active: "bg-green-50 text-green-700", contingent: "bg-amber-50 text-amber-700", pending: "bg-amber-50 text-amber-700", closed: "bg-gray-100 text-gray-500" };

export default function ChicagoBrowse() {
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("250000");
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
    fetch("/api/admin/home-search/areas").then((r) => (r.ok ? r.json() : { clusters: [] })).then((d) => setClusters(d.clusters || [])).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    const p = new URLSearchParams();
    if (priceMin) p.set("priceMin", priceMin);
    if (priceMax) p.set("priceMax", priceMax);
    if (beds) p.set("beds", beds);
    if (q) p.set("q", q);
    if (sel.size) p.set("neighborhoods", [...sel].join(","));
    p.set("sort", sort); p.set("page", String(page)); p.set("pageSize", String(pageSize));
    abortRef.current?.abort();               // cancel any in-flight request (T1: no stale/races)
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const r = await fetch(`/api/admin/home-search/dataset?${p.toString()}`, { cache: "no-store", signal: ctrl.signal });
      if (r.ok) setData(await r.json());
    } catch (e) {
      if ((e as any)?.name === "AbortError") return; // superseded request — ignore
      setMsg(e instanceof Error ? e.message : "could not load listings");
    }
  }, [priceMin, priceMax, beds, q, sel, sort, page]);

  useEffect(() => {
    const t = setTimeout(() => { load(); }, 300); // debounce rapid filter typing
    return () => clearTimeout(t);
  }, [load]);

  const toggleArea = (a: string) => {
    setPage(1);
    setSel((prev) => { const n = new Set(prev); n.has(a) ? n.delete(a) : n.add(a); return n; });
  };

  const sweep = async (body: Record<string, unknown>, label: string) => {
    setBusy(true); setMsg(`Compiling ${label}…`);
    try {
      const r = await fetch("/api/admin/home-search/sweep", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || `sweep ${r.status}`);
      const s = d.sweep || {};
      if (s.skipped) { setMsg("A compile is already running — try again in a moment."); return; }
      setMsg(`Swept ${(s.areasSwept || []).length} area(s): ${s.newRows ?? 0} new, ${s.verified ?? 0} verified.`);
      await load();
    } catch (e) { setMsg(e instanceof Error ? e.message : "sweep failed"); }
    finally { setBusy(false); }
  };

  const pages = Math.max(1, Math.ceil(data.total / pageSize));

  return (
    <div className="mb-8 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Browse Chicago listings</h2>
          <p className="text-xs text-gray-500">Compiled from public MLS-fed sources. Filter by price and neighborhood; addresses shown.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {sel.size > 0 && (
            <button onClick={() => { const b = [...sel].slice(0, 8); sweep({ areas: b }, `${b.length} selected area(s)${sel.size > 8 ? " (first 8 — select fewer for the rest)" : ""}`); }} disabled={busy}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">Compile selected ({sel.size})</button>
          )}
          <button onClick={() => sweep({ areas: clusters[0]?.areas ?? [] }, "Wicker Park area")} disabled={busy}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-gray-400 disabled:opacity-50">Compile Wicker Park area</button>
          <button onClick={() => sweep({ rolling: true, maxAreas: 6 }, "more of Chicago")} disabled={busy}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-gray-400 disabled:opacity-50">Compile more of Chicago</button>
        </div>
      </div>
      {msg && <div className="mt-2 text-xs text-gray-600">{msg}</div>}

      {/* Filters */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <L label="Min price"><input className="in" value={priceMin} onChange={(e) => { setPage(1); setPriceMin(e.target.value); }} inputMode="numeric" placeholder="any" /></L>
        <L label="Max price"><input className="in" value={priceMax} onChange={(e) => { setPage(1); setPriceMax(e.target.value); }} inputMode="numeric" placeholder="any" /></L>
        <L label="Min beds"><input className="in" value={beds} onChange={(e) => { setPage(1); setBeds(e.target.value); }} inputMode="numeric" placeholder="any" /></L>
        <L label="Sort"><select className="in" value={sort} onChange={(e) => { setPage(1); setSort(e.target.value); }}><option value="price_asc">Price ↑</option><option value="price_desc">Price ↓</option><option value="newest">Newest</option></select></L>
        <L label="Address contains"><input className="in" value={q} onChange={(e) => { setPage(1); setQ(e.target.value); }} placeholder="e.g. Damen" /></L>
      </div>

      {/* Neighborhood chips */}
      <div className="mt-3">
        {clusters.map((c) => (
          <div key={c.name} className="mb-2">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{c.name}</div>
            <div className="flex flex-wrap gap-1.5">
              {c.areas.map((a) => (
                <button key={a} onClick={() => toggleArea(a)} type="button"
                  className={`rounded-full border px-2.5 py-0.5 text-xs ${sel.has(a) ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-600 hover:border-gray-300"}`}>{a}</button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Results */}
      <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
        <span>{data.total} listing(s){sel.size ? ` in ${sel.size} area(s)` : ""}</span>
        <span>page {page} / {pages}</span>
      </div>
      <div className="mt-1 overflow-x-auto rounded-md border border-gray-100">
        <table className="w-full text-sm">
          <thead><tr className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <th className="px-3 py-2">Price</th><th className="px-3 py-2">Address</th><th className="px-3 py-2">Area</th><th className="px-3 py-2">Bd/Ba</th><th className="px-3 py-2">Sqft</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">DOM</th><th className="px-3 py-2"></th>
          </tr></thead>
          <tbody>
            {data.listings.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-sm text-gray-400">{sel.size > 0 ? `No listings for the selected area(s) yet — click \u201cCompile selected (${sel.size})\u201d above to fetch them.` : "No listings match — adjust filters, or compile an area above."}</td></tr>}
            {data.listings.map((l) => (
              <tr key={l.id} className="border-t border-gray-50">
                <td className="px-3 py-2 font-medium tabular-nums text-gray-900">{usd(l.price)}</td>
                <td className="px-3 py-2 text-gray-700">{l.address}{l.unit ? ` #${l.unit}` : ""}{l.zip ? `, ${l.zip}` : ""}</td>
                <td className="px-3 py-2 text-gray-500">{l.neighborhood ?? "—"}</td>
                <td className="px-3 py-2 text-gray-600">{l.beds ?? "?"}/{l.baths ?? "?"}</td>
                <td className="px-3 py-2 text-gray-500 tabular-nums">{l.sqft ?? "—"}</td>
                <td className="px-3 py-2"><span className={`rounded px-1.5 py-0.5 text-xs ${STATUS[l.status] || "bg-gray-100 text-gray-500"}`}>{l.status}</span></td>
                <td className="px-3 py-2 text-gray-500 tabular-nums">{l.daysOnMarket ?? "—"}</td>
                <td className="px-3 py-2"><a href={l.sourceUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">open</a></td>
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
