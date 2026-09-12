import { format, parseISO } from "date-fns";
import type { Kind, RuleAction, Sieve, SieveCondition } from "@/types";

function readableDate(value: string): string {
  const date = parseISO(value);
  if (Number.isNaN(date.getTime())) return value;
  return format(date, "MMMM d, yyyy");
}

export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function uniqueName(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base;
  let n = 2;
  while (existing.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export function kindByTitle(kinds: Kind[], key: string): string {
  const k = kinds.find((x) => x.name === key);
  return k ? k.title : key;
}

export function allKnownExtensions(kinds: Kind[]): string[] {
  const set = new Set<string>();
  for (const k of kinds) for (const e of k.extensions) set.add(e.toLowerCase());
  return Array.from(set).sort();
}

const EXTENSION_PATTERN = /^[a-z0-9]+(?:\.[a-z0-9]+)*$/;

export function isValidExtension(raw: string): boolean {
  const s = raw.trim().toLowerCase();
  return s !== "" && EXTENSION_PATTERN.test(s);
}

export function isValidCompoundSuffix(raw: string): boolean {
  const s = raw.trim().toLowerCase();
  return EXTENSION_PATTERN.test(s) && s.includes(".");
}

/// Mirrors `Sieve::missing_kinds` in src-tauri/src/sieves.rs — keep in sync
/// if the matching rule ever changes. (Computed client-side on purpose: it
/// re-evaluates instantly when kinds change, without re-fetching sieves.)
export function missingKinds(sieve: Sieve, kinds: Kind[]): string[] {
  const set = new Set<string>();
  for (const c of sieve.conditions) {
    if (c.property !== "kind") continue;
    for (const v of c.values) {
      if (!kinds.some((k) => k.name === v)) set.add(v);
    }
  }
  return Array.from(set);
}

/// Mirrors `Sieve::is_runnable` in src-tauri/src/sieves.rs — keep in sync if
/// the runnable rule ever changes (e.g. also requiring a watched folder).
export function isRunnable(sieve: Sieve): boolean {
  return sieve.conditions.length > 0 && sieve.actions.length > 0;
}

function describeCondition(c: SieveCondition, kinds: Kind[]): string {
  const values = c.values
    .map((v) => (c.property === "kind" ? kindByTitle(kinds, v) : v))
    .join(", ");
  switch (c.property) {
    case "kind":
      return `Kind ${c.operator === "is" ? "is" : "isn't"} ${values}`;
    case "extension":
      return `Extension ${c.operator === "is" ? "is" : "isn't"} ${values}`;
    case "name":
      return `Name ${c.operator === "matches" ? "matches" : "doesn't match"} ${values}`;
    case "modified": {
    const dates = c.values.map(readableDate).join(", ");
    return `Modified ${c.operator} ${dates}`;
  }
    case "type":
      return c.values[0] === "folder" ? "Type is a Folder" : "Type is a File";
  }
}

export function describeConditions(sieve: Sieve, kinds: Kind[]): string {
  if (sieve.conditions.length === 0) return "any file";
  const parts = sieve.conditions.map((c) => describeCondition(c, kinds));
  return sieve.mode === "all" ? parts.join(" and ") : parts.join(" or ");
}

function describeAction(action: RuleAction): string {
  switch (action.type) {
    case "move":
      return `Move to ${action.folder}`;
    case "copy":
      return `Copy to ${action.folder}`;
    case "rename":
      return `Rename to ${action.name}`;
    case "delete":
      return action.mode === "recycle" ? "Move to Recycle Bin" : "Delete Permanently";
  }
}

export function describeActions(actions: RuleAction[]): string {
  return actions.map(describeAction).join("; then ");
}