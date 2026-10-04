import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const SALT = "outreach-engine-burner-credentials";

export class CredentialKeyError extends Error {
  constructor() {
    super("Set BURNER_CREDENTIALS_KEY or SITE_PASSWORD before saving burner passwords.");
    this.name = "CredentialKeyError";
  }
}

export class CredentialDecryptError extends Error {
  constructor() {
    super(
      "Couldn't read this password. The encryption key may have changed since it was saved.",
    );
    this.name = "CredentialDecryptError";
  }
}

let cached: { secret: string; key: Buffer } | null = null;

function encryptionKey(): Buffer {
  const secret = process.env.BURNER_CREDENTIALS_KEY || process.env.SITE_PASSWORD || "";
  if (!secret) throw new CredentialKeyError();
  if (cached?.secret === secret) return cached.key;
  const key = scryptSync(secret, SALT, 32);
  cached = { secret, key };
  return key;
}

/** AES-256-GCM. The payload is not the password. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), data.toString("base64url")].join(
    ".",
  );
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") throw new CredentialDecryptError();
  const [, iv, tag, data] = parts;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(data, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch (err) {
    if (err instanceof CredentialKeyError) throw err;
    throw new CredentialDecryptError();
  }
}
