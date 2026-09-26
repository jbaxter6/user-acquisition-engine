const SUFFIXES: [number, string][] = [
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "k"],
];

// 12_500 -> "12.5k", 1_000_000 -> "1M", 950 -> "950".
export function formatCount(n: number): string {
  for (const [size, suffix] of SUFFIXES) {
    if (Math.abs(n) >= size) {
      const scaled = n / size;
      const digits = scaled >= 100 ? 0 : 1;
      return `${Number(scaled.toFixed(digits))}${suffix}`;
    }
  }
  return String(Number(n.toFixed(2)));
}

// Accepts what people actually type: "10k", "1.2M", "10,000", "2.5 b".
// Returns null for anything that isn't a non-negative number.
export function parseCount(input: string): number | null {
  const m = input.trim().replace(/,/g, "").match(/^(\d+(?:\.\d+)?|\.\d+)\s*([kmb])?$/i);
  if (!m) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[m[2]?.toLowerCase() as "k" | "m" | "b"] ?? 1;
  return Math.round(Number(m[1]) * mult * 100) / 100;
}
