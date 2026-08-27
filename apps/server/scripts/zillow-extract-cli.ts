/**
 * One-shot Zillow lead extraction from the signed-in Safari session.
 * Usage: tsx scripts/zillow-extract-cli.ts [outDir]
 * Exit codes: 0 ok · 2 needs manual Safari login · 1 anything else.
 */
import { runZillowExtraction, ZillowExtractError } from "../src/services/zillow-extract.js";

const outDir = process.argv[2] || new URL("../../../.zillow", import.meta.url).pathname;

try {
  const result = await runZillowExtraction({ outDir });
  console.log(JSON.stringify({
    ok: true,
    leads: result.leads.length,
    totalLeadCount: result.totalLeadCount,
    rawJsonPath: result.rawJsonPath,
  }));
} catch (err) {
  if (err instanceof ZillowExtractError) {
    console.log(JSON.stringify({ ok: false, kind: err.kind, detail: err.message }));
    process.exit(err.kind === "needs-login" ? 2 : 1);
  }
  console.log(JSON.stringify({ ok: false, kind: "unknown", detail: String(err) }));
  process.exit(1);
}
