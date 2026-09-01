import { describe, it, expect } from "vitest";
import { parseMovotoIndex, makePublicIndexProvider, type Fetcher } from "../services/listings-explorer/public-index-provider.js";

const HTML = `
<script type="application/ld+json">{"@type":"Organization","name":"Movoto"}</script>
<script type="application/ld+json">[
 {"@type":"Product","name":"2011 W Chase Ave #2, Chicago, IL 60645","offers":{"@type":"Offer","price":299500,"url":"https://www.movoto.com/chicago-il/2011-w-chase-ave-apt-2/"},"address":{"streetAddress":"2011 W Chase Ave #2","postalCode":"60645"},"geo":{"latitude":42.01,"longitude":-87.68}},
 {"@type":"Product","name":"1527 W Juneway Ter, Chicago, IL 60626","offers":{"price":795000,"url":"https://www.movoto.com/chicago-il/1527-w-juneway/"},"address":{"streetAddress":"1527 W Juneway Ter","postalCode":"60626"}}
]</script>`;

describe("parseMovotoIndex", () => {
  it("extracts address/unit/zip/price/url from ld+json Products", () => {
    const rows = parseMovotoIndex(HTML);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ address: "2011 W Chase Ave", unit: "2", zip: "60645", price: 299500 });
    expect(rows[0].url).toContain("movoto.com");
    expect(rows[1]).toMatchObject({ address: "1527 W Juneway Ter", unit: null, price: 795000 });
  });
});

describe("PublicIndexProvider", () => {
  it("maps index rows to listings (unit ⇒ condo, none ⇒ single_family) + links out", async () => {
    const fetch = (async () => ({ ok: true, status: 200, async text() { return HTML; } })) as unknown as Fetcher;
    const p = makePublicIndexProvider({ fetch });
    const out = await p.fetchArea({ name: "Rogers Park", zips: ["60626"] }, {});
    expect(out).toHaveLength(2);
    expect(out.find((x) => x.address.includes("Chase"))!.propertyType).toBe("condo");
    expect(out.find((x) => x.address.includes("Juneway"))!.propertyType).toBe("single_family");
    expect(out.every((x) => x.sourceUrl && x.source === "movoto")).toBe(true);
  });
  it("index 403 → fail-soft []", async () => {
    const fetch = (async () => ({ ok: false, status: 403, async text() { return ""; } })) as unknown as Fetcher;
    expect(await makePublicIndexProvider({ fetch }).fetchArea({ name: "X", zips: [] }, {})).toEqual([]);
  });
});
