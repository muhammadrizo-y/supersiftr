export type RuleAction =
  | { type: "move"; destination: string }
  | { type: "copy"; destination: string }
  | { type: "rename"; pattern: string };

export type ActionType = RuleAction["type"];

export type ConditionMode = "all" | "any";

export type ConditionProperty = "kind" | "extension" | "name" | "modified";

export type ConditionOperator =
  | "is"
  | "is_not"
  | "matches"
  | "not_matches"
  | "after"
  | "before";

export type SieveCondition = {
  property: ConditionProperty;
  operator: ConditionOperator;
  values: string[];
};

export type Sieve = {
  name: string;
  watched_folders: string[];
  mode: ConditionMode;
  conditions: SieveCondition[];
  actions: RuleAction[];
};

export type Preset = {
  name: string;
  title: string;
  extensions: string[];
};

export type AppConfig = {
  version: number;
  show_in_tray: boolean;
};

export type ActivityEntry = {
  id: number;
  message: string;
  level: "info" | "error";
};

export type View =
  | { kind: "sieve"; index: number }
  | { kind: "edit"; index: number }
  | { kind: "new" }
  | { kind: "activity" }
  | { kind: "settings" };