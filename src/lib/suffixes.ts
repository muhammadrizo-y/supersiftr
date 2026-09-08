export const DEFAULT_SUFFIXES = [
  ".tar.gz",
  ".tar.bz2",
  ".tar.xz",
  ".tar.zst",
  ".d.ts",
  ".test.ts",
  ".spec.ts",
  ".min.js",
];

export type SuffixSplit = { base: string; suffix: string };

/// Mirrors `suffix::split` in Rust: longest configured suffix wins, otherwise
/// falls back to the final dot extension; a dotfile has no suffix.
export function splitSuffix(fileName: string, customSuffixes: string[]): SuffixSplit {
  let best = "";
  for (const s of [...DEFAULT_SUFFIXES, ...customSuffixes]) {
    if (fileName.length > s.length && fileName.endsWith(s) && s.length > best.length) {
      best = s;
    }
  }
  if (best) return { base: fileName.slice(0, -best.length), suffix: best };
  const i = fileName.lastIndexOf(".");
  if (i > 0) return { base: fileName.slice(0, i), suffix: fileName.slice(i) };
  return { base: fileName, suffix: "" };
}

export function normalizeCustomSuffix(input: string, existing: string[]): string | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;
  if (!s.startsWith(".")) s = `.${s}`;
  if (DEFAULT_SUFFIXES.includes(s) || existing.includes(s)) return null;
  return s;
}

/// Mirrors the rename action in src-tauri/src/actions.rs: `{name}` is replaced
/// by the original base name (suffix stripped), then the suffix is re-appended.
export function formatRenamePreview(fileName: string, newName: string, customSuffixes: string[]) {
  const { base, suffix } = splitSuffix(fileName, customSuffixes);
  const resolved = newName.replace(/\{name\}/g, base).trim() || "…";
  return `${resolved}${suffix}`;
}