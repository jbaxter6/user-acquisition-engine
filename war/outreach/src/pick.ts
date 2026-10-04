export type ProspectCard = {
  username: string;
  // "Copy & open in Instagram", or null when the card has no open button.
  openLabel: string | null;
};

export function cardKey(platform: string, username: string): string {
  return `${platform}:${username.trim().replace(/^@/, "").toLowerCase()}`;
}

// First page only, in the order the CRM rendered them. Already-sent people
// stay on Not Contacted until Sync, so the local log is what skips them.
export function pickBatch(
  cards: ProspectCard[],
  sent: Set<string>,
  platform: string,
  limit: number,
): ProspectCard[] {
  const chosen: ProspectCard[] = [];
  const seen = new Set<string>();
  for (const card of cards) {
    if (chosen.length >= limit) break;
    if (!card.username || !card.openLabel) continue;
    const key = cardKey(platform, card.username);
    if (seen.has(key) || sent.has(key)) continue;
    seen.add(key);
    chosen.push(card);
  }
  return chosen;
}
