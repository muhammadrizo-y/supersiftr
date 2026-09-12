export type DeleteMode = "recycle" | "permanent";

export type RuleAction =
  | { type: "move"; folder: string }
  | { type: "copy"; folder: string }
  | { type: "rename"; name: string }
  | { type: "delete"; mode: DeleteMode };

export type ActionType = RuleAction["type"];

export type ConditionMode = "all" | "any";

export type ConditionProperty = "kind" | "extension" | "name" | "modified" | "type";

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
  enabled: boolean;
};

export type Kind = {
  name: string;
  title: string;
  extensions: string[];
  enabled: boolean;
  is_default: boolean;
};

export type DateFormat = "us" | "uk";

export type AppConfig = {
  schema_version: number;
  show_in_tray: boolean;
  date_format: DateFormat;
};

export type ConfigView = {
  config: AppConfig;
  fresh: boolean;
};

export type CompoundExtensionsView = {
  defaults: string[];
  custom: string[];
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

export type LicenseStatus = "inactive" | "active" | "invalid";

export type LicenseStore = {
  key: string | null;
  activation_id: string | null;
  device_label: string | null;
  last_validated_at: string | null;
  status: LicenseStatus;
};