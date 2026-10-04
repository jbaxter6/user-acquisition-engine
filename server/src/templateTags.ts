// Tags label a kind of prompt ("opener", "follow-up"). They are not the
// {{tokens}} inside the message, and changing them does not change which
// sent message the stats attach to.

export const MAX_TAGS = 8;
export const MAX_TAG_LENGTH = 32;

export class TagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TagError";
  }
}

// Missing tags means "none". A non-list is a bad request. Blank entries are
// dropped, and "Opener" / "opener" collapse to the first spelling.
export function normalizeTags(input: unknown): string[] {
  if (input == null) return [];
  if (!Array.isArray(input)) throw new TagError("tags must be a list");

  const tags: string[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (typeof item !== "string") throw new TagError("tags must be a list of words");
    for (const part of item.split(",")) {
      const tag = part.trim().replace(/\s+/g, " ");
      if (!tag) continue;
      if (tag.length > MAX_TAG_LENGTH) {
        throw new TagError(`Tags can be at most ${MAX_TAG_LENGTH} characters`);
      }
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push(tag);
    }
  }
  if (tags.length > MAX_TAGS) {
    throw new TagError(`A template can have at most ${MAX_TAGS} tags`);
  }
  return tags;
}
