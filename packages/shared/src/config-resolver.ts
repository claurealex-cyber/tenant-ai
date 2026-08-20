import { decrypt } from "./encryption.js";
import { INTEGRATION_REGISTRY, configDbKey } from "./integrations.js";

interface CacheEntry {
  value: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

export interface ConfigStore {
  get(key: string): Promise<string | null>;
}

let _store: ConfigStore | null = null;

export function initConfigResolver(store: ConfigStore): void {
  _store = store;
}

export function clearConfigCache(): void {
  cache.clear();
}

export async function resolveConfig(
  integrationId: string,
  fieldKey: string,
  defaultValue?: string
): Promise<string | null> {
  const dbKey = configDbKey(integrationId, fieldKey);

  const cached = cache.get(dbKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  if (_store) {
    try {
      const encrypted = await _store.get(dbKey);
      if (encrypted) {
        const value = decrypt(encrypted);
        cache.set(dbKey, {
          value,
          expiresAt: Date.now() + CACHE_TTL_MS,
        });
        return value;
      }
    } catch {
      // DB read or decrypt failed — fall through to env var
    }
  }

  const fieldDef = INTEGRATION_REGISTRY.find(
    (i) => i.id === integrationId
  )?.fields.find((f) => f.key === fieldKey);

  if (fieldDef) {
    const envValue = process.env[fieldDef.envVar];
    if (envValue) {
      cache.set(dbKey, {
        value: envValue,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      return envValue;
    }
  }

  if (defaultValue !== undefined) {
    return defaultValue;
  }

  return null;
}

export async function resolveIntegration(
  integrationId: string
): Promise<Record<string, string | null>> {
  const def = INTEGRATION_REGISTRY.find((i) => i.id === integrationId);
  if (!def) return {};

  const result: Record<string, string | null> = {};
  for (const field of def.fields) {
    result[field.key] = await resolveConfig(integrationId, field.key);
  }
  return result;
}
