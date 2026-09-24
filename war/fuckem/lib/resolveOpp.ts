export interface OppTarget {
  slot: number;
  folder: string;
  url: string;
}

export function getOppUrlEnvKey(slot: number): string {
  return `OPP${slot}_URL`;
}

export function parseOppUrls(
  env: Record<string, string | undefined> = {},
): OppTarget[] {
  const out: OppTarget[] = [];

  let index = 1;
  while (true) {
    const key = getOppUrlEnvKey(index);
    const url = env[key]?.trim();
    if (!url) break;

    out.push({
      slot: index,
      folder: `OPP${index}`,
      url,
    });

    index += 1;
  }

  return out;
}

export function resolveOppByUrl(
  env: Record<string, string | undefined> = {},
  targetUrl: string,
): OppTarget | null {
  const normalizedTarget = targetUrl.trim();
  if (!normalizedTarget) return null;

  const opps = parseOppUrls(env);
  return opps.find((opp) => opp.url.trim() === normalizedTarget) ?? null;
}

export function resolveOppBySlot(
  env: Record<string, string | undefined> = {},
  slot: number,
): OppTarget | null {
  const opps = parseOppUrls(env);
  return opps.find((opp) => opp.slot === slot) ?? null;
}
