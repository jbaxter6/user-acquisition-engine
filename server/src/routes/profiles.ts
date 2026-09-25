import { Router } from "express";
import type { Platform } from "../adapters/types.js";
import {
  createTargetProfile,
  getTargetProfileById,
  listTargetProfiles,
  setTargetProfileArchived,
  updateTargetProfile,
  type TargetProfileInput,
} from "../db.js";
import {
  ATTRIBUTES,
  OPERATORS_BY_TYPE,
  attributesForPlatform,
  incompatibleCriteria,
  validateCriteria,
  type Criterion,
} from "../profiles/attributes.js";

const PLATFORMS: Platform[] = ["instagram", "tiktok", "twitch", "youtube"];
const COLOR_RE = /^#[0-9a-f]{6}$/i;

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

  router.put("/:id", (req, res) => {
    const id = Number(req.params.id);
    const existing = getTargetProfileById(id);
    if (!existing) return res.status(404).json({ error: "profile not found" });

    // Changing platform with criteria that don't exist on the new platform
    // is refused with the offending ids, rather than silently dropping
    // them — the client confirms with the user, strips, and resubmits.
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (isPlatform(body.platform) && body.platform !== existing.platform && Array.isArray(body.criteria)) {
      const incompatible = incompatibleCriteria(
        body.criteria.filter(
          (c): c is Criterion => typeof c === "object" && c !== null && typeof c.attribute === "string",
        ),
        body.platform,
      );
      if (incompatible.length) {
        return res.status(409).json({
          error: `${incompatible.length} criteria aren't available on ${body.platform}`,
          incompatible: incompatible.map((c) => c.id),
        });
      }
    }

    const parsed = parseBody(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.errors.join("; "), errors: parsed.errors });
    res.json(updateTargetProfile(id, parsed.input));
  });

  router.post("/:id/duplicate", (req, res) => {
    const source = getTargetProfileById(Number(req.params.id));
    if (!source) return res.status(404).json({ error: "profile not found" });
    res.status(201).json(
      createTargetProfile({
        name: `${source.name} (copy)`.slice(0, 120),
        description: source.description,
        platform: source.platform,
        criteria: source.criteria,
        color: source.color,
      }),
    );
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
