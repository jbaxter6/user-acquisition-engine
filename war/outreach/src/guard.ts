// Login walls, challenges, and rate-limit pages. Matching one stops the run.
const BLOCK_URL = [/\/accounts\/login/i, /\/challenge/i, /checkpoint/i, /captcha/i, /\/login/i];

const BLOCK_TEXT = [
  "try again later",
  "action blocked",
  "we limit how often",
  "confirm it's you",
  "confirm it’s you",
  "suspicious activity",
  "please wait a few minutes",
  "feedback required",
];

export class StopRun extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StopRun";
  }
}

// This person can't take a message (no Message button). The run continues.
export class SkipPerson extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkipPerson";
  }
}

export function blockReason(url: string, headingText: string): string | null {
  for (const pattern of BLOCK_URL) {
    if (pattern.test(url)) return `The page is a login wall or a challenge (${url}).`;
  }
  const text = headingText.toLowerCase();
  for (const phrase of BLOCK_TEXT) {
    if (text.includes(phrase)) return `The platform asked us to stop ("${phrase}").`;
  }
  return null;
}

export function assertHandleAllowed(handle: string, blocked: string[]): void {
  const name = handle.trim().replace(/^@/, "").toLowerCase();
  if (blocked.includes(name)) {
    throw new StopRun(
      `@${name} is a Smooth account. Log out of it in this Chrome window, log into the throwaway, and run again.`,
    );
  }
}
