import { Router } from "express";
import type { Platform } from "../adapters/types.js";
import {
  createTargetProfile,
  getTargetProfileById,
  listProspectsForMatching,
  listTargetProfiles,
  setTargetProfileArchived,
  type TargetProfileInput,
} from "../db.js";
import {
  ATTRIBUTES,
  OPERATORS_BY_TYPE,
  attributesForPlatform,
  validateCriteria,
  type Criterion,
} from "../profiles/attributes.js";
import { summarize } from "../profiles/match.js";

const PLATFORMS: Platform[] = ["instagram", "tiktok", "twitch", "youtube"];
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const STATUSES = ["new", "contacted", "replied", "closed"];

function isPlatform(value: unknown): value is Platform {
  return typeof value === "string" && (PLATFORMS as string[]).includes(value);
}

// Parses and validates a create/update body. Returns the clean input or a
// list of human-readable errors for a 400.
function parseBody(
  body: unknown,
): { ok: true; input: TargetProfileInput } | { ok: false; errors: string[] } {
  const b = (body ?? {}) as Record<string, unknown>;
  const errors: string[] = [];

  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) errors.push("name is required");
  else if (name.length > 120) errors.push("name must be 120 characters or fewer");

  const description =
    typeof b.description === "string" && b.description.trim()
      ? b.description.trim()
      : null;
  if (description && description.length > 2000)
    errors.push("description must be 2000 characters or fewer");

  if (!isPlatform(b.platform))
    errors.push(`platform must be one of ${PLATFORMS.join(", ")}`);

  const color =
    typeof b.color === "string" && b.color.trim() ? b.color.trim() : null;
  if (color && !COLOR_RE.test(color)) errors.push("color must be a #rrggbb hex");

  let criteria: Criterion[] = [];
  if (isPlatform(b.platform)) {
    const result = validateCriteria(b.criteria ?? [], b.platform);
    if (result.ok) criteria = result.criteria;
    else errors.push(...result.errors);
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    input: { name, description, platform: b.platform as Platform, criteria, color },
  };
}

export function profilesRouter(): Router {
  const router = Router();

  // The registry — the Profiles form is rendered from this.
  router.get("/attributes", (req, res) => {
    const { platform } = req.query as { platform?: string };
    if (platform !== undefined && !isPlatform(platform)) {
      return res.status(400).json({ error: `unknown platform "${platform}"` });
    }
    res.json({
      attributes: platform ? attributesForPlatform(platform) : ATTRIBUTES,
      operators: OPERATORS_BY_TYPE,
    });
  });

  router.get("/", (req, res) => {
    const { platform, includeArchived } = req.query as Record<string, string | undefined>;
    if (platform !== undefined && !isPlatform(platform)) {
      return res.status(400).json({ error: `unknown platform "${platform}"` });
    }
    res.json(listTargetProfiles({ platform, includeArchived: includeArchived === "true" }));
  });

  // Match counts for every active profile — the list badges. Computed on
  // read; see docs/profiles-live-view-architecture.md §4.
  router.get("/summaries", (_req, res) => {
    const prospectsByPlatform = new Map<string, ReturnType<typeof listProspectsForMatching>>();
    const out: Record<number, { match: number; possible: number; total: number }> = {};
    for (const profile of listTargetProfiles({})) {
      let prospects = prospectsByPlatform.get(profile.platform);
      if (!prospects) {
        prospects = listProspectsForMatching(profile.platform);
        prospectsByPlatform.set(profile.platform, prospects);
      }
      const { match, possible, total } = summarize(profile.criteria, prospects);
      out[profile.id] = { match, possible, total };
    }
    res.json(out);
  });

  router.get("/:id", (req, res) => {
    const profile = getTargetProfileById(Number(req.params.id));
    if (!profile) return res.status(404).json({ error: "profile not found" });
    res.json(profile);
  });

  router.post("/", (req, res) => {
    const parsed = parseBody(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.errors.join("; "), errors: parsed.errors });
    res.status(201).json(createTargetProfile(parsed.input));
  });

  // Profiles are immutable once created: match counts (and later Discovery
  // runs) refer to a profile by id, so its criteria can't change under it.
  // To change one, use it as a template for a new profile.
  router.put("/:id", (_req, res) => {
    res.status(405).json({ error: "profiles can't be changed once created; use it as a template instead" });
  });

  router.get("/:id/summary", (req, res) => {
    const profile = getTargetProfileById(Number(req.params.id));
    if (!profile) return res.status(404).json({ error: "profile not found" });
    const { status } = req.query as { status?: string };
    if (status !== undefined && !STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of ${STATUSES.join(", ")}` });
    }
    res.json(summarize(profile.criteria, listProspectsForMatching(profile.platform, status)));
  });

  router.post("/:id/restore", (req, res) => {
    const id = Number(req.params.id);
    if (!getTargetProfileById(id)) return res.status(404).json({ error: "profile not found" });
    setTargetProfileArchived(id, false);
    res.json(getTargetProfileById(id));
  });

  router.delete("/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!getTargetProfileById(id)) return res.status(404).json({ error: "profile not found" });
    setTargetProfileArchived(id, true);
    res.json({ ok: true });
  });

  return router;
}
