export type RuleAction =
  | { type: "move"; destination: string }
  | { type: "copy"; destination: string }
  | { type: "rename"; pattern: string };

export type ActionType = RuleAction["type"];

export type MatchCriteria = {
  extension: string[];
  name_pattern?: string | null;
  date_after?: string | null;
  date_before?: string | null;
};

export type Preset = {
  name: string;
  title: string;
  extensions: string[];
};

export type Rule = {
  name: string;
  watched_folders: string[];
  kind: string[];
  match_criteria: MatchCriteria;
  action: RuleAction;
};

export type AppConfig = {
  rules: Rule[];
};

export type ActivityEntry = {
  id: number;
  message: string;
  level: "info" | "error";
};

export type View =
  | { kind: "rule"; index: number }
  | { kind: "new" }
  | { kind: "activity" }
  | { kind: "settings" };