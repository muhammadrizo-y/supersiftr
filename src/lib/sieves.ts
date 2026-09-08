import type { Kind, RuleAction, Sieve, SieveCondition } from "@/types";

export function kindByTitle(kinds: Kind[], key: string): string {
  const k = kinds.find((x) => x.name === key);
  return k ? k.title : key;
}

export function allKnownExtensions(kinds: Kind[]): string[] {
  const set = new Set<string>();
  for (const k of kinds) for (const e of k.extensions) set.add(e.toLowerCase());
  return Array.from(set).sort();
}

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
    case "modified":
      return `Modified ${c.operator} ${values}`;
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
  }
}

export function describeActions(actions: RuleAction[]): string {
  return actions.map(describeAction).join("; then ");
}