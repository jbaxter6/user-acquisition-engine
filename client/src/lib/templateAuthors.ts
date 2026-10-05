export const TEMPLATE_AUTHORS = ["john", "justin"] as const;
export type TemplateAuthor = (typeof TEMPLATE_AUTHORS)[number];

const LABELS: Record<TemplateAuthor, string> = {
  john: "John",
  justin: "Justin",
};

export function isTemplateAuthor(value: string): value is TemplateAuthor {
  return (TEMPLATE_AUTHORS as readonly string[]).includes(value);
}

export function authorLabel(author: string): string {
  return isTemplateAuthor(author) ? LABELS[author] : author;
}
