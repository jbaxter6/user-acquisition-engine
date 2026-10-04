import { Router } from "express";
import {
  archiveMessageTemplate,
  createMessageTemplate,
  getMessageTemplateById,
  getMessageTemplateStats,
  listMessageTemplates,
  updateMessageTemplate,
} from "../db.js";
import { normalizeTags, TagError } from "../templateTags.js";

export function templatesRouter(): Router {
  const router = Router();

  router.get("/", (req, res) => {
    const { includeArchived } = req.query as { includeArchived?: string };
    res.json(listMessageTemplates(includeArchived === "true"));
  });

  router.get("/stats", (_req, res) => {
    res.json(getMessageTemplateStats());
  });

  router.post("/", (req, res) => {
    const { name, body, tags } = req.body as { name?: string; body?: string; tags?: unknown };
    if (!name?.trim() || !body?.trim()) {
      return res.status(400).json({ error: "name and body are required" });
    }
    let normalized: string[];
    try {
      normalized = normalizeTags(tags);
    } catch (err) {
      if (err instanceof TagError) return res.status(400).json({ error: err.message });
      throw err;
    }
    res.status(201).json(createMessageTemplate(name.trim(), body.trim(), normalized));
  });

  router.put("/:id", (req, res) => {
    const { name, body, tags } = req.body as { name?: string; body?: string; tags?: unknown };
    if (!name?.trim() || !body?.trim()) {
      return res.status(400).json({ error: "name and body are required" });
    }
    const id = Number(req.params.id);
    const existing = getMessageTemplateById(id);
    if (!existing) return res.status(404).json({ error: "template not found" });
    let normalized: string[];
    try {
      // Omitting tags keeps whatever is already on the template.
      normalized = tags === undefined ? existing.tags : normalizeTags(tags);
    } catch (err) {
      if (err instanceof TagError) return res.status(400).json({ error: err.message });
      throw err;
    }
    // Once a template has gone out, editing the words would silently detach
    // every past message from its stats. Tags are only a label, so they
    // stay editable.
    const textChanged = name.trim() !== existing.name || body.trim() !== existing.body;
    const stats = getMessageTemplateStats().find((t) => t.id === id);
    if (textChanged && stats && stats.sent > 0) {
      return res.status(409).json({
        error: "This template is live (already sent) and can't be edited. Duplicate it to make changes.",
      });
    }
    const updated = updateMessageTemplate(id, name.trim(), body.trim(), normalized);
    if (!updated) return res.status(404).json({ error: "template not found" });
    res.json(updated);
  });

  router.delete("/:id", (req, res) => {
    archiveMessageTemplate(Number(req.params.id));
    res.json({ ok: true });
  });

  return router;
}
