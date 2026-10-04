import { readFileSync, writeFileSync } from "node:fs";

export type SentOutcome = "sent" | "unconfirmed" | "noted";

export type SentRecord = {
  platform: string;
  username: string;
  template: string;
  at: string;
  outcome: SentOutcome;
  email?: string;
};

export type SentLog = Record<string, SentRecord>;

export function loadSent(path: string): SentLog {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as SentLog;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveSent(path: string, log: SentLog): void {
  writeFileSync(path, `${JSON.stringify(log, null, 2)}\n`);
}
