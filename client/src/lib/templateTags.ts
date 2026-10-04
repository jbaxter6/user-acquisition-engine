// Tags already on templates, first spelling wins, alphabetical.
export function tagsInUse(templates: { tags?: string[] }[]): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const template of templates) {
    for (const tag of template.tags ?? []) {
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push(tag);
    }
  }
  return tags.sort((a, b) => a.localeCompare(b));
}

export function hasTag(tags: string[] | undefined, tag: string): boolean {
  const key = tag.toLowerCase();
  return (tags ?? []).some((item) => item.toLowerCase() === key);
}
