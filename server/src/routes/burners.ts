import { Router } from "express";
import type { Platform } from "../adapters/types.js";
import {
  deleteBurnerAccount,
  getBurnerAccount,
  insertBurnerAccount,
  listBurnerAccounts,
  updateBurnerAccount,
} from "../db.js";
import {
  CredentialDecryptError,
  CredentialKeyError,
  decryptSecret,
  encryptSecret,
} from "../secrets.js";

const PLATFORMS: Platform[] = ["instagram", "tiktok", "twitch", "youtube"];

// Same brand handles WAR refuses to send from. A burner vault is for
// throwaways; saving a Smooth login here is the mistake IMPORTANT.md exists to prevent.
const SMOOTH_HANDLES = ["movewithsmooth", "smoothmediatechnologies"];

function isUniqueConstraint(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    String((err as { code: unknown }).code).startsWith("SQLITE_CONSTRAINT")
  );
}

function optionalText(value: unknown, max: number): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value == null || value === "") return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, error: "notes and email must be text" };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > max) return { ok: false, error: `must be ${max} characters or fewer` };
  return { ok: true, value: trimmed };
}

function parseFields(
  body: unknown,
  opts: { passwordRequired: boolean },
):
  | {
      ok: true;
      platform: Platform;
      username: string;
      password: string | null;
      email: string | null;
      notes: string | null;
    }
  | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.platform !== "string" || !(PLATFORMS as string[]).includes(b.platform)) {
    return { ok: false, error: "platform must be instagram, tiktok, twitch, or youtube" };
  }
  if (typeof b.username !== "string") return { ok: false, error: "username is required" };
  const username = b.username.trim().replace(/^@+/, "").toLowerCase();
  if (!/^[a-z0-9._]{1,64}$/.test(username)) {
    return { ok: false, error: "username must be a social handle (letters, numbers, . and _)" };
  }
  if (SMOOTH_HANDLES.includes(username)) {
    return {
      ok: false,
      error: `@${username} is a Smooth account. Burners are throwaways only.`,
    };
  }

  let password: string | null = null;
  if (b.password != null && b.password !== "") {
    if (typeof b.password !== "string") return { ok: false, error: "password must be text" };
    if (b.password.length > 500) return { ok: false, error: "password is too long" };
    password = b.password;
  } else if (opts.passwordRequired) {
    return { ok: false, error: "password is required" };
  }

  const email = optionalText(b.email, 200);
  if (!email.ok) return { ok: false, error: `email ${email.error}` };
  if (email.value && !email.value.includes("@")) {
    return { ok: false, error: "email must include @" };
  }
  const notes = optionalText(b.notes, 2000);
  if (!notes.ok) return { ok: false, error: `notes ${notes.error}` };

  return {
    ok: true,
    platform: b.platform as Platform,
    username,
    password,
    email: email.value,
    notes: notes.value,
  };
}

function withPassword(row: NonNullable<ReturnType<typeof getBurnerAccount>>) {
  const { password_enc, ...publicRow } = row;
  return { ...publicRow, password: decryptSecret(password_enc) };
}

function sendCredentialError(res: import("express").Response, err: unknown): boolean {
  if (err instanceof CredentialKeyError) {
    res.status(503).json({ error: err.message });
    return true;
  }
  if (err instanceof CredentialDecryptError) {
    res.status(422).json({ error: err.message });
    return true;
  }
  return false;
}

export function burnersRouter(): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(listBurnerAccounts());
  });

  router.get("/:id", (req, res) => {
    const row = getBurnerAccount(Number(req.params.id));
    if (!row) return res.status(404).json({ error: "burner account not found" });
    try {
      res.json(withPassword(row));
    } catch (err) {
      if (sendCredentialError(res, err)) return;
      throw err;
    }
  });

  router.post("/", (req, res) => {
    const parsed = parseFields(req.body, { passwordRequired: true });
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    try {
      const created = insertBurnerAccount({
        platform: parsed.platform,
        username: parsed.username,
        passwordEnc: encryptSecret(parsed.password!),
        email: parsed.email,
        notes: parsed.notes,
      });
      res.status(201).json(created);
    } catch (err) {
      if (sendCredentialError(res, err)) return;
      if (isUniqueConstraint(err)) {
        return res.status(409).json({
          error: `@${parsed.username} is already saved for ${parsed.platform}.`,
        });
      }
      throw err;
    }
  });

  router.put("/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!getBurnerAccount(id)) return res.status(404).json({ error: "burner account not found" });
    const parsed = parseFields(req.body, { passwordRequired: false });
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    try {
      const updated = updateBurnerAccount(id, {
        platform: parsed.platform,
        username: parsed.username,
        passwordEnc: parsed.password ? encryptSecret(parsed.password) : null,
        email: parsed.email,
        notes: parsed.notes,
      });
      if (!updated) return res.status(404).json({ error: "burner account not found" });
      res.json(updated);
    } catch (err) {
      if (sendCredentialError(res, err)) return;
      if (isUniqueConstraint(err)) {
        return res.status(409).json({
          error: `@${parsed.username} is already saved for ${parsed.platform}.`,
        });
      }
      throw err;
    }
  });

  router.delete("/:id", (req, res) => {
    if (!deleteBurnerAccount(Number(req.params.id))) {
      return res.status(404).json({ error: "burner account not found" });
    }
    res.json({ ok: true });
  });

  return router;
}
