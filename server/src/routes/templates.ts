import { Router } from "express";
import {
  archiveMessageTemplate,
  createMessageTemplate,
  getMessageTemplateStats,
  listMessageTemplates,
  updateMessageTemplate,
} from "../db.js";

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
    const { name, body } = req.body as { name?: string; body?: string };
    if (!name?.trim() || !body?.trim()) {
      return res.status(400).json({ error: "name and body are required" });
    }
    res.status(201).json(createMessageTemplate(name.trim(), body.trim()));
  });

  router.put("/:id", (req, res) => {
    const { name, body } = req.body as { name?: string; body?: string };
    if (!name?.trim() || !body?.trim()) {
      return res.status(400).json({ error: "name and body are required" });
    }
    const id = Number(req.params.id);
    // Once a template has gone out, editing it would silently detach every
    // past message from its stats — so it's locked; duplicate it instead.
    const stats = getMessageTemplateStats().find((t) => t.id === id);
    if (stats && stats.sent > 0) {
      return res.status(409).json({
        error: "This template is live (already sent) and can't be edited. Duplicate it to make changes.",
      });
    }
    const updated = updateMessageTemplate(id, name.trim(), body.trim());
    if (!updated) return res.status(404).json({ error: "template not found" });
    res.json(updated);
  });

  router.delete("/:id", (req, res) => {
    archiveMessageTemplate(Number(req.params.id));
    res.json({ ok: true });
  });

  return router;
}
