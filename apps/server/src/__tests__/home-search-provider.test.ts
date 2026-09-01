import { describe, it, expect, vi, beforeEach } from "vitest";

const cfg: Record<string, string | null> = { "home_search.search_api_key": "test-brave-key" };
vi.mock("@tenant-ai/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tenant-ai/shared")>();
  return { ...actual, resolveConfig: async (ns: string, k: string) => cfg[`${ns}.${k}`] ?? null };
});
import { makeSearchProvider, type Fetcher } from "../services/home-search/search-provider.js";

function braveResult(url: string, title: string, desc = "") { return { url, title, description: desc }; }
function res(body: any, ok = true, status = 200): any {
  return { ok, status, async json() { return body; }, async text() { return typeof body === "string" ? body : JSON.stringify(body); } };
}

beforeEach(() => {});

describe("SearchProvider — #1 snippet extraction + #2 readable-source verify", () => {
  it("discover parses price/address/beds/unit from Brave snippets (#1) + dedupes", async () => {
    const fetch = vi.fn(async (url: string) =>
      url.includes("brave") ? res({ web: { results: [
        braveResult("https://www.movoto.com/x", "3845 W Altgeld St #G — $194,000", "2 bd condo for sale"),
        braveResult("https://www.movoto.com/x", "dup", "dup"), // dup url
      ] } }) : res("")) as unknown as Fetcher;
    const p = makeSearchProvider({ fetch });
    const cands = await p.discover({ areaTag: "Wicker Park", priceMax: 250000, zips: [] });
    expect(cands).toHaveLength(1); // dedup by url
    expect(cands[0].priceHint).toBe(194000);
    expect(cands[0].bedsHint).toBe(2);
    expect(cands[0].address).toContain("3845 W Altgeld St");
    expect(cands[0].unit).toBe("G");
  });

  it("verify fetches a READABLE page and confirms active (#2)", async () => {
    const fetch = vi.fn(async (url: string) =>
      url.includes("movoto") ? res("This condo is For Sale, list price $194,000, 2 beds, 900 sq ft.") : res("")) as unknown as Fetcher;
    const p = makeSearchProvider({ fetch });
    const v = await p.verify({ source: "movoto.com", url: "https://www.movoto.com/x", address: "3845 W Altgeld St", unit: "G", priceHint: 194000, bedsHint: 2, snippet: "for sale" });
    expect(v).not.toBeNull();
    expect(v!.status).toBe("active");
    expect(v!.price).toBe(194000);
  });

  it("blocked-source candidate → snippet fallback (#1) when no readable page", async () => {
    // brave re-search returns only blocked domains; page fetch 403s
    const fetch = vi.fn(async (url: string) => {
      if (url.includes("brave")) return res({ web: { results: [braveResult("https://www.zillow.com/y", "z")] } });
      return res("", false, 403);
    }) as unknown as Fetcher;
    const p = makeSearchProvider({ fetch });
    const v = await p.verify({ source: "zillow.com", url: "https://www.zillow.com/y", address: "500 N Damen Ave", unit: "307", priceHint: 250000, bedsHint: 1, snippet: "500 N Damen #307 for sale $250,000, updated kitchen" });
    expect(v).not.toBeNull();
    expect(v!.status).toBe("active"); // snippet says for-sale, no sold/pending markers
    expect(v!.price).toBe(250000);
  });

  it("snippet that says SOLD → not verified (snippets lie)", async () => {
    const fetch = vi.fn(async (url: string) => (url.includes("brave") ? res({ web: { results: [] } }) : res("", false, 403))) as unknown as Fetcher;
    const p = makeSearchProvider({ fetch });
    const v = await p.verify({ source: "zillow.com", url: "https://www.zillow.com/y", address: "3555 W Lyndale St", unit: "1C", priceHint: 234900, snippet: "3555 W Lyndale sold $234,900" });
    expect(v).toBeNull();
  });

  it("does NOT mis-parse a 7-figure price as a low <=250k number (B3)", async () => {
    const fetch = vi.fn(async (url: string) =>
      url.includes("brave") ? res({ web: { results: [braveResult("https://www.movoto.com/z", "1234 W Foo St #5 — $1,250,000", "2 bd condo for sale")] } }) : res("")) as unknown as Fetcher;
    const p = makeSearchProvider({ fetch });
    const cands = await p.discover({ areaTag: "X", zips: [] });
    expect(cands).toHaveLength(1);
    // $1,250,000 must never become 250000 (a false <=250k). Null or the real value only.
    expect(cands[0].priceHint === null || cands[0].priceHint! >= 1_000_000).toBe(true);
  });

  it("no search key → discover no-op (fail-soft)", async () => {
    delete cfg["home_search.search_api_key"];
    const p = makeSearchProvider({ fetch: (async () => res({})) as unknown as Fetcher });
    expect(await p.discover({ areaTag: "x", zips: [] })).toEqual([]);
    cfg["home_search.search_api_key"] = "test-brave-key";
  });
});
