import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

function getAllTsxFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === "node_modules" || entry === ".next" || entry === "__tests__") continue;
    if (statSync(full).isDirectory()) files.push(...getAllTsxFiles(full));
    else if (full.endsWith(".tsx")) files.push(full);
  }
  return files;
}

describe("Navigation consistency", () => {
  it("dashboard pages do not use window.location.href for in-app navigation", () => {
    const dir = join(__dirname, "..", "app");
    const files = getAllTsxFiles(dir);
    const violations: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      const matches = content.match(/window\.location\.(href|replace)\s*=\s*["`']\//g);
      if (matches) {
        // Allow onboarding (full reload needed) and settings (Stripe external URL)
        if (file.includes("onboarding") || file.includes("settings")) continue;
        violations.push(file);
      }
    }
    expect(violations).toEqual([]);
  });
});
