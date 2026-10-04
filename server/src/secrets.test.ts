import { afterEach, describe, expect, it } from "vitest";
import {
  CredentialDecryptError,
  CredentialKeyError,
  decryptSecret,
  encryptSecret,
} from "./secrets.js";

const ORIGINAL_KEY = process.env.BURNER_CREDENTIALS_KEY;
const ORIGINAL_SITE = process.env.SITE_PASSWORD;

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.BURNER_CREDENTIALS_KEY;
  else process.env.BURNER_CREDENTIALS_KEY = ORIGINAL_KEY;
  if (ORIGINAL_SITE === undefined) delete process.env.SITE_PASSWORD;
  else process.env.SITE_PASSWORD = ORIGINAL_SITE;
});

describe("burner credential encryption", () => {
  it("round-trips a password and does not store it in the clear", () => {
    process.env.BURNER_CREDENTIALS_KEY = "test-key";
    const payload = encryptSecret("hunter2! ");
    expect(payload.startsWith("v1.")).toBe(true);
    expect(payload).not.toContain("hunter2");
    expect(decryptSecret(payload)).toBe("hunter2! ");
  });

  it("refuses to encrypt when no key is configured", () => {
    process.env.BURNER_CREDENTIALS_KEY = "";
    process.env.SITE_PASSWORD = "";
    expect(() => encryptSecret("x")).toThrow(CredentialKeyError);
  });

  it("fails closed when the key changes", () => {
    process.env.BURNER_CREDENTIALS_KEY = "one";
    process.env.SITE_PASSWORD = "";
    const payload = encryptSecret("secret");
    process.env.BURNER_CREDENTIALS_KEY = "two";
    expect(() => decryptSecret(payload)).toThrow(CredentialDecryptError);
  });
});
