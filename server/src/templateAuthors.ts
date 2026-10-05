// Who wrote a template. A pitch can belong to more than one person.
// The stored values stay lowercase; the UI capitalizes them.

export const TEMPLATE_AUTHORS = ["john", "justin"] as const;
export type TemplateAuthor = (typeof TEMPLATE_AUTHORS)[number];

export class AuthorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorError";
  }
}

function isAuthor(value: string): value is TemplateAuthor {
  return (TEMPLATE_AUTHORS as readonly string[]).includes(value);
}

// Missing authors means "none". A non-list is a bad request. Names outside
// John and Justin are rejected. Order is always John, then Justin.
export function normalizeAuthors(input: unknown): TemplateAuthor[] {
  if (input == null) return [];
  if (!Array.isArray(input)) throw new AuthorError("authors must be a list");

  const seen = new Set<TemplateAuthor>();
  for (const item of input) {
    if (typeof item !== "string") throw new AuthorError("authors must be a list of names");
    const name = item.trim().toLowerCase();
    if (!name) continue;
    if (!isAuthor(name)) throw new AuthorError('authors must be "john" or "justin"');
    seen.add(name);
  }
  return TEMPLATE_AUTHORS.filter((name) => seen.has(name));
}
