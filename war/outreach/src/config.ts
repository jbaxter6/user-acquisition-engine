export type Platform = "instagram" | "tiktok" | "youtube";

// Brand accounts this runner must never send from. Env can add more, not remove these.
const ALWAYS_BLOCKED = ["movewithsmooth", "smoothmediatechnologies"];

const PLATFORMS: Platform[] = ["instagram", "tiktok", "youtube"];
const MIN_GAP_MS = 15_000;
const MAX_BATCH = 20;

export type Config = {
  crmUrl: string;
  crmPassword: string | null;
  platform: Platform;
  templateName: string;
  batchSize: number;
  minDelayMs: number;
  maxDelayMs: number;
  dryRun: boolean;
  blockedHandles: string[];
};

export function normalizeHandle(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required. See .env.example.`);
  return value;
}

function intEnv(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new Error(`${key} must be a whole number of milliseconds.`);
  return n;
}

export function parseConfig(env: NodeJS.ProcessEnv): Config {
  const crmUrl = required(env, "CRM_URL").replace(/\/$/, "");
  if (!/^https?:\/\//.test(crmUrl)) throw new Error("CRM_URL must start with http:// or https://.");

  const platform = required(env, "PLATFORM").toLowerCase();
  if (!PLATFORMS.includes(platform as Platform)) {
    throw new Error(`PLATFORM must be one of: ${PLATFORMS.join(", ")}.`);
  }

  const batchSize = intEnv(env, "BATCH_SIZE", 10);
  if (batchSize < 1 || batchSize > MAX_BATCH) {
    throw new Error(`BATCH_SIZE must be from 1 to ${MAX_BATCH}. A normal run is 10–20.`);
  }

  const minDelayMs = intEnv(env, "MIN_DELAY_MS", 45_000);
  const maxDelayMs = intEnv(env, "MAX_DELAY_MS", 90_000);
  if (minDelayMs < MIN_GAP_MS || maxDelayMs < MIN_GAP_MS) {
    throw new Error(`MIN_DELAY_MS and MAX_DELAY_MS must be at least ${MIN_GAP_MS}.`);
  }
  if (minDelayMs > maxDelayMs) throw new Error("MIN_DELAY_MS cannot be greater than MAX_DELAY_MS.");

  const extra = (env.BLOCKED_HANDLES ?? "")
    .split(",")
    .map(normalizeHandle)
    .filter(Boolean);

  const dry = (env.DRY_RUN ?? "").trim().toLowerCase();

  return {
    crmUrl,
    crmPassword: env.CRM_PASSWORD?.trim() || null,
    platform: platform as Platform,
    templateName: required(env, "TEMPLATE_NAME"),
    batchSize,
    minDelayMs,
    maxDelayMs,
    dryRun: dry === "1" || dry === "true" || dry === "yes",
    blockedHandles: [...new Set([...ALWAYS_BLOCKED, ...extra])],
  };
}
