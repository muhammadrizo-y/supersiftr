import type { ReactNode } from "react";
import { FolderSearch, Funnel, Pencil, TriangleAlert, Zap, BadgeCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { isRunnable, hasProFeatures, kindByTitle, missingKinds, readableDate } from "@/lib/sieves";
import { cn } from "@/lib/utils";
import type {
  ArchiveFormat,
  ConditionOperator,
  ConditionProperty,
  DeleteMode,
  ExtractSourceMode,
  Kind,
  RuleAction,
  Sieve,
  SieveCondition,
  SortKey,
} from "@/types";

const PROPERTY_LABELS: Record<ConditionProperty, string> = {
  kind: "Kind",
  extension: "Extension",
  name: "Name",
  modified: "Modified",
  type: "Type",
};

const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  is: "is",
  is_not: "isn't",
  matches: "matches",
  not_matches: "doesn't match",
  after: "after",
  before: "before",
};

const ACTION_LABELS: Record<RuleAction["type"], string> = {
  move: "Move",
  copy: "Copy",
  rename: "Rename",
  delete: "Delete",
  sort_into: "Sort into Subfolder",
  compress: "Compress",
  extract: "Extract",
};

const DELETE_MODE_LABELS: Record<DeleteMode, string> = {
  recycle: "Move to Recycle Bin",
  permanent: "Delete Permanently",
};

const SORT_KEY_LABELS: Record<SortKey, string> = {
  kind: "Kind",
  extension: "Extension",
};

const SOURCE_LABELS: Record<ExtractSourceMode, string> = {
  keep: "Keep Source",
  recycle: "Move Source to Recycle Bin",
  delete: "Delete Source Permanently",
};

function formatLabel(value: ArchiveFormat): string {
  return value.replace("_", ".");
}

function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md border border-border bg-muted px-2 py-0.5 text-xs font-medium text-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 text-xs text-muted-foreground">{children}</span>
  );
}

function PathText({ children }: { children: ReactNode }) {
  return (
    <span className="min-w-0 flex-1 select-text truncate font-mono text-xs">
      {children}
    </span>
  );
}

function conditionValueLabel(condition: SieveCondition, value: string, kinds: Kind[]): string {
  switch (condition.property) {
    case "kind":
      return kindByTitle(kinds, value);
    case "type":
      return value === "folder" ? "Folder" : "File";
    case "modified":
      return readableDate(value);
    default:
      return value;
  }
}

function ConditionRow({ condition, kinds }: { condition: SieveCondition; kinds: Kind[] }) {
  return (
    <li className="flex flex-wrap items-center gap-1.5 px-3 py-2">
      <Chip>{PROPERTY_LABELS[condition.property]}</Chip>
      {condition.property !== "type" && <Chip>{OPERATOR_LABELS[condition.operator]}</Chip>}
      {condition.property === "name" && condition.syntax && (
        <Chip>{condition.syntax === "regex" ? "Regex" : "Pattern"}</Chip>
      )}
      {condition.values.map((value, i) => (
        <Chip key={i}>{conditionValueLabel(condition, value, kinds)}</Chip>
      ))}
    </li>
  );
}

function ActionRow({ action }: { action: RuleAction }) {
  switch (action.type) {
    case "move":
    case "copy":
      return (
        <li className="flex items-center gap-1.5 px-3 py-2">
          <Chip>{ACTION_LABELS[action.type]}</Chip>
          <PathText>{action.folder}</PathText>
        </li>
      );
    case "rename":
      return (
        <li className="flex flex-wrap items-center gap-1.5 px-3 py-2">
          <Chip>{ACTION_LABELS.rename}</Chip>
          <Muted>to:</Muted>
          <span className="select-text truncate font-mono text-xs">{action.name}</span>
        </li>
      );
    case "delete":
      return (
        <li className="flex items-center gap-1.5 px-3 py-2">
          <Chip>{ACTION_LABELS.delete}</Chip>
          <Chip>{DELETE_MODE_LABELS[action.mode]}</Chip>
        </li>
      );
    case "sort_into":
      return (
        <li className="flex flex-wrap items-center gap-1.5 px-3 py-2">
          <Chip>{ACTION_LABELS.sort_into}</Chip>
          <PathText>{action.folder}</PathText>
          <Muted>by</Muted>
          <Chip>{SORT_KEY_LABELS[action.by]}</Chip>
        </li>
      );
    case "compress":
      return (
        <li className="flex flex-wrap items-center gap-1.5 px-3 py-2">
          <Chip>{ACTION_LABELS.compress}</Chip>
          <Muted>to</Muted>
          <Chip>{formatLabel(action.format)}</Chip>
          <Muted>then</Muted>
          <Chip>{SOURCE_LABELS[action.source]}</Chip>
        </li>
      );
    case "extract":
      return (
        <li className="flex items-center gap-1.5 px-3 py-2">
          <Chip>{ACTION_LABELS.extract}</Chip>
          <Muted>then</Muted>
          <Chip>{SOURCE_LABELS[action.source]}</Chip>
        </li>
      );
  }
}

function Section({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex h-10 items-center justify-between gap-2 border-b border-border bg-muted/40 px-3">
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
          {icon}
          <span className="shrink-0 font-semibold uppercase tracking-wider">{title}</span>
          {subtitle != null && (
            <span className="flex min-w-0 items-center gap-1.5 truncate font-normal normal-case text-foreground">
              {subtitle}
            </span>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

function EmptyBody({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 py-6 text-center text-xs text-muted-foreground">
      {children}
    </div>
  );
}

export function SieveDetail({
  sieve,
  index,
  kinds,
  isPro,
  onGoToSettings,
  onEdit,
  onToggleEnabled,
}: {
  sieve: Sieve;
  index: number;
  kinds: Kind[];
  isPro: boolean;
  onGoToSettings: () => void;
  onEdit: (index: number) => void;
  onToggleEnabled: (index: number, enabled: boolean) => void;
}) {
  const missing = missingKinds(sieve, kinds);
  const proGated = !isPro && hasProFeatures(sieve);
  return (
    <section className="px-6 py-5">
      {proGated && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-orange-500/40 bg-orange-500/10 px-3 py-2 text-sm text-orange-600 dark:text-orange-400">
          <BadgeCheck className="mt-0.5 size-4 shrink-0" />
          <span className="flex-1">
            This sieve uses Pro features (Regex matching, Sort into Subfolder,
            Compress, or Extract) and is turned off until a license is
            activated.
          </span>
          <Button size="sm" variant="outline" onClick={onGoToSettings}>
            Activate license
          </Button>
        </div>
      )}
      {missing.length > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            Missing kind{missing.length > 1 ? "s" : ""}:{" "}
            {missing.map((m) => kindByTitle(kinds, m)).join(", ")}.
            This kind does not exist.
          </span>
        </div>
      )}
      {!isRunnable(sieve) && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>This sieve has no conditions or actions and will never run.</span>
        </div>
      )}
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-2xl font-semibold">{sieve.name}</h2>
        <div className="flex items-center gap-3">
          <Tooltip>
            <TooltipTrigger
              render={
                <div>
                  <Switch
                    checked={proGated ? false : sieve.enabled}
                    disabled={proGated}
                    onCheckedChange={(checked) => onToggleEnabled(index, checked)}
                    aria-label={sieve.enabled ? "Disable sieve" : "Enable sieve"}
                  />
                </div>
              }
            />
            {proGated && <TooltipContent>Locked — requires a Pro activation.</TooltipContent>}
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button size="sm" variant="outline" onClick={() => onEdit(index)}>
                  <Pencil className="size-3.5" /> Edit
                </Button>
              }
            />
            <TooltipContent>Edit this sieve</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="space-y-4">
        <Section icon={<FolderSearch className="size-3.5 shrink-0" />} title="Watched Folders">
          {sieve.watched_folders.length === 0 ? (
            <EmptyBody>No folders watched.</EmptyBody>
          ) : (
            <ul className="divide-y divide-border">
              {sieve.watched_folders.map((folder) => (
                <li key={folder} className="px-3 py-2">
                  <span className="block select-text truncate font-mono text-xs">
                    {folder}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section
          icon={<Funnel className="size-3.5 shrink-0" />}
          title="Match"
          subtitle={
            <>
              If <Chip>{sieve.mode}</Chip> of the conditions are met
            </>
          }
        >
          {sieve.conditions.length === 0 ? (
            <EmptyBody>No conditions — matches any file.</EmptyBody>
          ) : (
            <ul className="divide-y divide-border">
              {sieve.conditions.map((condition, i) => (
                <ConditionRow key={i} condition={condition} kinds={kinds} />
              ))}
            </ul>
          )}
        </Section>
        <Section
          icon={<Zap className="size-3.5 shrink-0" />}
          title="Actions"
          subtitle="Do the following to the matched file"
        >
          {sieve.actions.length === 0 ? (
            <EmptyBody>No actions defined.</EmptyBody>
          ) : (
            <ul className="divide-y divide-border">
              {sieve.actions.map((action, i) => (
                <ActionRow key={i} action={action} />
              ))}
            </ul>
          )}
        </Section>
      </div>
    </section>
  );
}