import { defineConfig, type Plugin } from "vitest/config";
import path from "path";

const ROOT = __dirname;
const TENANT_SITE_SRC = path.resolve(ROOT, "apps/tenant-site/src");
const DASHBOARD_SRC = path.resolve(ROOT, "apps/dashboard/src");

/**
 * Resolves the @/ alias contextually based on the importing file's location.
 * Files in apps/tenant-site/ → apps/tenant-site/src/
 * Files in apps/dashboard/  → apps/dashboard/src/
 * Fallback                  → apps/dashboard/src/
 */
function contextualAliasPlugin(): Plugin {
  return {
    name: "contextual-at-alias",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!source.startsWith("@/")) return null;
      const relative = source.slice(2); // strip "@/"
      const base =
        importer && importer.includes("/apps/tenant-site/")
          ? TENANT_SITE_SRC
          : DASHBOARD_SRC;
      const fullPath = path.resolve(base, relative);
      // Use Vite's resolver for extension resolution (.ts, .js, /index.ts, etc.)
      const resolved = await this.resolve(fullPath, importer, {
        ...options,
        skipSelf: true,
      });
      return resolved ?? fullPath;
    },
  };
}

export default defineConfig({
  plugins: [contextualAliasPlugin()],
  test: {
    include: [
      "packages/shared/src/__tests__/**/*.test.ts",
      "apps/server/src/__tests__/**/*.test.ts",
      "apps/dashboard/src/__tests__/**/*.test.ts",
      "apps/dashboard/src/__tests__/**/*.test.tsx",
      "apps/tenant-site/src/__tests__/**/*.test.ts",
      "apps/tenant-site/src/__tests__/**/*.test.tsx",
    ],
    exclude: ["**/dist/**", "**/node_modules/**"],
    testTimeout: 30000,
  },
});
